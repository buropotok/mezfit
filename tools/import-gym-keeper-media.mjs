import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { spawn } from 'node:child_process';

const DATASET_REPO = 'https://github.com/hasaneyldrm/exercises-dataset.git';
const DATASET_RAW_BASE = 'https://raw.githubusercontent.com/hasaneyldrm/exercises-dataset/main';
const WORKER_BASE = process.env.MEZFIT_WORKER_BASE || 'https://mezfit.buropotok.workers.dev';
const GITHUB_REPOSITORY = process.env.GITHUB_REPOSITORY || 'buropotok/mezfit';
const CONCURRENCY = 4;
const MAX_BYTES = 8 * 1024 * 1024;
const EXPECTED_MEDIA_COUNT = 334;
const dryRun = process.argv.includes('--dry-run');
const keepFiles = process.argv.includes('--keep-files');
const tempDir = process.env.GK_MEDIA_TMP || '.tmp/gym-keeper-media';
const datasetDir = join(tempDir, 'exercises-dataset');

export function extractReferenceKeysFromSeedSql(sql) {
  return [...sql.matchAll(/'gym_keeper_apk',\s*'((?:''|[^'])+\.gif)'/gi)].map((match) => match[1].replaceAll("''", "'"));
}

export async function loadReferenceKeys() {
  const migrationFiles = (await readdir('migrations')).filter((file) => /^\d+_.*\.sql$/i.test(file)).sort();
  const discovered = [];
  for (const file of migrationFiles) discovered.push(...extractReferenceKeysFromSeedSql(await readFile(join('migrations', file), 'utf8')));
  const unique = [...new Set(discovered)];
  if (unique.length !== EXPECTED_MEDIA_COUNT) throw new Error(`Expected ${EXPECTED_MEDIA_COUNT} unique Gym Keeper media keys, found ${unique.length}`);
  return unique;
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit', shell: false });
    child.once('error', reject);
    child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`${command} exited with ${code}`)));
  });
}

function normalize(value) {
  return value.toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').replace(/\b(male|female)\b/g, ' ').replace(/\s+/g, ' ').trim();
}
function apkName(referenceKey) {
  return referenceKey.replace(/^\d+-/, '').replace(/_(?:Back|Cardio|Chest|Forearms|Lower-Arms|Lower-Legs|Neck|Shoulders|Upper-Arms|Upper-Legs|Waist|Hips|Thighs|Calves|Full-Body|Other)_180\.gif$/i, '').replace(/_180\.gif$/i, '').replace(/[-_]+/g, ' ').trim();
}
function tokenScore(a, b) {
  const aa = new Set(normalize(a).split(' ').filter(Boolean));
  const bb = new Set(normalize(b).split(' ').filter(Boolean));
  if (!aa.size || !bb.size) return 0;
  let common = 0;
  for (const token of aa) if (bb.has(token)) common += 1;
  return (2 * common) / (aa.size + bb.size);
}
function buildMatches(referenceKeys, exercises) {
  const byNormalizedName = new Map();
  for (const exercise of exercises) {
    const key = normalize(exercise.name);
    const list = byNormalizedName.get(key) || [];
    list.push(exercise);
    byNormalizedName.set(key, list);
  }
  return referenceKeys.map((referenceKey) => {
    const name = apkName(referenceKey);
    const exact = byNormalizedName.get(normalize(name)) || [];
    if (exact.length === 1) return { referenceKey, apkName: name, exercise: exact[0], match: 'exact', score: 1 };
    const ranked = exercises.map((exercise) => ({ exercise, score: tokenScore(name, exercise.name) })).filter((item) => item.score >= 0.86).sort((a, b) => b.score - a.score);
    if (ranked.length && (ranked.length === 1 || ranked[0].score - ranked[1].score >= 0.12)) return { referenceKey, apkName: name, exercise: ranked[0].exercise, match: 'probable', score: ranked[0].score };
    return { referenceKey, apkName: name, exercise: null, match: 'unmatched', score: ranked[0]?.score || 0 };
  });
}

async function downloadAndUpload(match, index, total) {
  const url = `${DATASET_RAW_BASE}/${match.exercise.gif_url}`;
  const response = await fetch(url, { headers: { accept: 'image/gif' }, redirect: 'follow' });
  if (!response.ok) throw new Error(`Download failed ${response.status}: ${url}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength < 6 || bytes.byteLength > MAX_BYTES) throw new Error(`Invalid media size: ${match.referenceKey}`);
  const signature = new TextDecoder('ascii').decode(bytes.subarray(0, 6));
  if (signature !== 'GIF87a' && signature !== 'GIF89a') throw new Error(`Expected GIF: ${match.referenceKey}`);
  const localPath = join(tempDir, basename(match.referenceKey));
  await writeFile(localPath, bytes);
  if (!dryRun) {
    const token = process.env.GITHUB_TOKEN;
    if (!token) throw new Error('GITHUB_TOKEN is required for Worker import');
    const upload = await fetch(`${WORKER_BASE}/api/exercise-media/gym_keeper_apk/${encodeURIComponent(match.referenceKey)}`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'x-github-repository': GITHUB_REPOSITORY,
        'content-type': 'image/gif',
      },
      body: bytes,
    });
    if (!upload.ok) throw new Error(`Worker upload failed ${upload.status}: ${await upload.text()}`);
  }
  console.log(`[${index + 1}/${total}] ${dryRun ? 'verified' : 'uploaded'} ${match.referenceKey} <- ${match.exercise.gif_url} (${match.match})`);
}

async function main() {
  await rm(tempDir, { recursive: true, force: true });
  await mkdir(tempDir, { recursive: true });
  const referenceKeys = await loadReferenceKeys();
  await run('git', ['clone', '--depth', '1', '--filter=blob:none', '--sparse', DATASET_REPO, datasetDir]);
  await run('git', ['-C', datasetDir, 'sparse-checkout', 'set', 'data']);
  const exercises = JSON.parse(await readFile(join(datasetDir, 'data', 'exercises.json'), 'utf8'));
  const matches = buildMatches(referenceKeys, exercises);
  const accepted = matches.filter((m) => m.exercise);
  const unmatched = matches.filter((m) => !m.exercise);
  await writeFile(join(tempDir, 'match-report.json'), JSON.stringify(matches.map((m) => ({ reference_key: m.referenceKey, apk_name: m.apkName, dataset_id: m.exercise?.id || null, dataset_name: m.exercise?.name || null, gif_url: m.exercise?.gif_url || null, match: m.match, score: Number(m.score.toFixed(3)) })), null, 2));
  console.log(`Matched ${accepted.length}/${referenceKeys.length}; unmatched ${unmatched.length}. Uploading all confident matches through Worker R2 binding.`);
  if (!accepted.length) throw new Error('No confident exercise media matches found');
  let cursor = 0;
  const failures = [];
  const workers = Array.from({ length: CONCURRENCY }, async () => {
    while (true) {
      const index = cursor++;
      if (index >= accepted.length) return;
      try { await downloadAndUpload(accepted[index], index, accepted.length); }
      catch (error) { failures.push({ referenceKey: accepted[index].referenceKey, error: error instanceof Error ? error.message : String(error) }); console.error(`[${index + 1}/${accepted.length}] FAILED ${accepted[index].referenceKey}: ${failures.at(-1).error}`); }
    }
  });
  try { await Promise.all(workers); }
  finally { if (!keepFiles) await rm(tempDir, { recursive: true, force: true }); }
  if (failures.length) throw new Error(`Uploaded ${accepted.length - failures.length}/${accepted.length} confident matches; ${failures.length} uploads failed`);
  console.log(`Exercise media import complete: ${accepted.length}/${referenceKeys.length} uploaded; ${unmatched.length} remain unmatched`);
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((error) => { console.error(error instanceof Error ? error.stack || error.message : error); process.exit(1); });
