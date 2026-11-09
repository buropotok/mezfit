import { execFile } from 'node:child_process';
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const root = new URL('../../', import.meta.url);
const execFileAsync = promisify(execFile);
const contracts = ['shared/relationship-id.ts', 'shared/approved-relationship.ts',
  'shared/discussion-anchor.ts', 'worker/lib/telegram.ts'];

export async function buildPackage(output = new URL('.yandex-media-package/', root)) {
  await rm(output, { recursive: true, force: true });
  const contractsOutput = new URL('contracts/', output);
  await mkdir(contractsOutput, { recursive: true });

  // Compile in a CommonJS package so NodeNext emits modules the function can require.
  const staging = await mkdtemp(join(tmpdir(), 'mezfit-media-contracts-'));
  try {
    await writeFile(join(staging, 'package.json'), JSON.stringify({ type: 'commonjs' }));
    for (const file of contracts) {
      const target = join(staging, file);
      await mkdir(dirname(target), { recursive: true });
      await cp(new URL(file, root), target);
    }
    const config = join(staging, 'tsconfig.json');
    await writeFile(config, JSON.stringify({
      compilerOptions: {
        target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext',
        lib: ['ES2022', 'DOM', 'DOM.Iterable'], types: [], strict: true,
        rootDir: '.', outDir: fileURLToPath(contractsOutput), noEmitOnError: true,
      },
      files: contracts,
    }));
    try {
      await execFileAsync('npm', ['exec', '--offline', '--', 'tsc', '--project', config], {
        cwd: fileURLToPath(root),
      });
    } catch (error) {
      throw new Error(`Media contract compilation failed: ${error.stdout || error.stderr || error.message}`, { cause: error });
    }
  } finally {
    await rm(staging, { recursive: true, force: true });
  }

  for (const file of ['index.js', 'protocol.js', 'authorization.js', 'storage.js', 'presign.js', 'package.json']) {
    await cp(new URL('infra/yandex-media-gateway/' + file, root), new URL(file, output));
  }
  await cp(new URL('dexie-cloud.json', root), new URL('dexie-cloud.json', contractsOutput));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await buildPackage();
