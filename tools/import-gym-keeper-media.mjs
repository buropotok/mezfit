import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { spawn } from 'node:child_process';

const SOURCE_BASE = 'https://47-1594.s.cdn13.com/img/gifs/180';
const R2_BUCKET = 'mezfit';
const R2_PREFIX = 'exercise-media/gym_keeper_apk';
const CONCURRENCY = 4;
const MAX_BYTES = 8 * 1024 * 1024;
const EXPECTED_MEDIA_COUNT = 334;
const dryRun = process.argv.includes('--dry-run');
const keepFiles = process.argv.includes('--keep-files');
const tempDir = process.env.GK_MEDIA_TMP || '.tmp/gym-keeper-media';

export function extractReferenceKeysFromSeedSql(sql) {
  return [...sql.matchAll(/'gym_keeper_apk',\s*'((?:''|[^'])+\.gif)'/gi)]
    .map((match) => match[1].replaceAll("''", "'"));
}

export async function loadReferenceKeys() {
  const migrationFiles = (await readdir('migrations'))
    .filter((file) => /^\d+_.*\.sql$/i.test(file))
    .sort();
  const discovered = [];

  for (const file of migrationFiles) {
    const sql = await readFile(join('migrations', file), 'utf8');
    discovered.push(...extractReferenceKeysFromSeedSql(sql));
  }

  const unique = [...new Set(discovered)];
  if (unique.length !== EXPECTED_MEDIA_COUNT) {
    throw new Error(
      `Expected ${EXPECTED_MEDIA_COUNT} unique Gym Keeper media keys, found ${unique.length} `
      + `(${discovered.length} SQL occurrences across ${migrationFiles.length} migrations)`,
    );
  }
  return unique;
}

function sourceUrl(referenceKey) {
  return `${SOURCE_BASE}/${encodeURIComponent(referenceKey)}`;
}

function r2Object(referenceKey) {
  return `${R2_BUCKET}/${R2_PREFIX}/${referenceKey}`;
}

async function run(command, args) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit', shell: false });
    child.once('error', reject);
    child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`${command} exited with ${code}`)));
  });
}

async function downloadAndUpload(referenceKey, index, total) {
  const url = sourceUrl(referenceKey);
  const response = await fetch(url, { headers: { accept: 'image/gif' } });
  if (!response.ok) throw new Error(`Download failed ${response.status}: ${url}`);

  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_BYTES) {
    throw new Error(`Invalid media size ${bytes.byteLength}: ${referenceKey}`);
  }
  const signature = new TextDecoder('ascii').decode(bytes.subarray(0, 6));
  if (signature !== 'GIF87a' && signature !== 'GIF89a') {
    throw new Error(`Expected GIF bytes for ${referenceKey}, got signature ${JSON.stringify(signature)}`);
  }

  const localPath = join(tempDir, basename(referenceKey));
  await writeFile(localPath, bytes);
  if (!dryRun) {
    await run('npx', [
      'wrangler', 'r2', 'object', 'put', r2Object(referenceKey),
      '--file', localPath,
      '--content-type', 'image/gif',
      '--remote',
    ]);
  }
  console.log(`[${index + 1}/${total}] ${dryRun ? 'verified' : 'uploaded'} ${referenceKey} (${bytes.byteLength} bytes)`);
}

async function main() {
  const keys = await loadReferenceKeys();
  await mkdir(tempDir, { recursive: true });
  console.log(`${dryRun ? 'Verifying' : 'Importing'} ${keys.length} Gym Keeper GIFs from ${SOURCE_BASE}`);

  let cursor = 0;
  const workers = Array.from({ length: CONCURRENCY }, async () => {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= keys.length) return;
      await downloadAndUpload(keys[index], index, keys.length);
    }
  });

  try {
    await Promise.all(workers);
  } finally {
    if (!keepFiles) await rm(tempDir, { recursive: true, force: true });
  }

  console.log(`Gym Keeper exercise media import complete: ${keys.length}/${keys.length}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack || error.message : error);
    process.exit(1);
  });
}
