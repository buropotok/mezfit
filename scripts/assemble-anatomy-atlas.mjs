// Assemble the approved full-resolution front PNG at build/dev start.
// GitHub's binary upload transport requires the immutable asset to be stored in
// smaller Base64 segments. Only this script joins them; the browser serves PNG.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const input = resolve(root, 'assets/anatomy/front');
const output = resolve(root, 'public/anatomy/front/color-atlas.png');
const count = 9;
const encoded = Array.from({ length: count }, (_, index) => {
  const part = String(index + 1).padStart(2, '0');
  return readFileSync(resolve(input, 'color-atlas.part-' + part + '.b64'), 'utf8').trim();
}).join('');

if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded) || encoded.length % 4 !== 0) {
  throw new Error('Incorrect front atlas Base64 chunks');
}
const png = Buffer.from(encoded, 'base64');
const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
if (!png.subarray(0, 8).equals(signature) || png.readUInt32BE(16) !== 1983 || png.readUInt32BE(20) !== 1207) {
  throw new Error('Unexpected approved front color atlas dimensions or format');
}

if (createHash('sha256').update(png).digest('hex') !== '80e46d5405ec4e744e59761592491f7eee3c11d22bfacf859f4bfa506ee46afa') {
  throw new Error('Front atlas chunks do not match the approved PNG');
}

if (!existsSync(output) || !readFileSync(output).equals(png)) {
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, png);
}
