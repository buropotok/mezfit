import ts from 'typescript';
import { readFile, writeFile, mkdir, cp, rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = new URL('../../', import.meta.url);
export async function buildPackage(output = new URL('.yandex-media-package/', root)) {
  await rm(output, { recursive: true, force: true });
  await mkdir(new URL('contracts/', output), { recursive: true });
  for (const file of ['index.js', 'protocol.js', 'authorization.js', 'storage.js', 'presign.js', 'package.json']) {
    await cp(new URL('infra/yandex-media-gateway/' + file, root), new URL(file, output));
  }
  await cp(new URL('dexie-cloud.json', root), new URL('contracts/dexie-cloud.json', output));
  for (const file of ['shared/relationship-id.ts', 'shared/approved-relationship.ts',
    'shared/discussion-anchor.ts', 'worker/lib/telegram.ts']) {
    const source = await readFile(new URL(file, root), 'utf8');
    const compiled = ts.transpileModule(source, { compilerOptions: {
      target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
    } }).outputText;
    const target = new URL('contracts/' + file.replace(/\.ts$/, '.js'), output);
    await mkdir(dirname(fileURLToPath(target)), { recursive: true });
    await writeFile(target, compiled);
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await buildPackage();
