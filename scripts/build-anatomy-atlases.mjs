#!/usr/bin/env node
/**
 * Reproducibly build the approved neutral PNG, color atlas, glow atlas and exact
 * hit-test mask from the repository's source PNG/MEZMASK1 files.
 * Runs before Vite starts; no raster work is needed in the Mini App.
 * Zero third-party/image-decoding dependencies.
 */
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { deflateSync, inflateSync } from 'node:zlib';

const ROOT = resolve(import.meta.dirname, '..');
const ANATOMY = join(ROOT, 'public', 'anatomy');
const PNG_MAGIC = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const MASK_MAGIC = Buffer.from('MEZMASK1');
const ATLAS_LIMIT = 2048;
const EDGE_PADDING = 22;

const crcTable = Array.from({ length: 256 }, (_, i) => {
  let c = i;
  for (let j = 0; j < 8; j += 1) c = c & 1 ? (0xedb88320 ^ (c >>> 1)) : c >>> 1;
  return c >>> 0;
});

function pngChunk(type, bytes) {
  const name = Buffer.from(type);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(bytes.length);
  let crc = 0xffffffff;
  for (const byte of Buffer.concat([name, bytes])) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([len, name, bytes, tail]);
}

function encodePng(rgba, width, height) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const stride = width * 4;
  const scanlines = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y += 1) rgba.copy(scanlines, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  return Buffer.concat([PNG_MAGIC, pngChunk('IHDR', header), pngChunk('IDAT', deflateSync(scanlines, { level: 8 })), pngChunk('IEND', Buffer.alloc(0))]);
}

function decodePng(data) {
  if (!data.subarray(0, 8).equals(PNG_MAGIC)) throw Error('Invalid source PNG signature');
  let width = 0, height = 0, channels = 0, interlace = 0, bitDepth = 0;
  const idat = [];
  for (let p = 8; p < data.length;) {
    const len = data.readUInt32BE(p); const type = data.toString('ascii', p + 4, p + 8);
    const bytes = data.subarray(p + 8, p + 8 + len);
    if (p + 12 + len > data.length) throw Error('Truncated PNG chunk');
    if (type === 'IHDR') {
      width = bytes.readUInt32BE(0); height = bytes.readUInt32BE(4);
      bitDepth = bytes[8]; channels = bytes[9] === 6 ? 4 : bytes[9] === 2 ? 3 : 0;
      interlace = bytes[12];
    } else if (type === 'IDAT') idat.push(bytes);
    else if (type === 'IEND') break;
    p += 12 + len;
  }
  if (!width || !height || bitDepth !== 8 || !channels || interlace !== 0) {
    throw Error('Expected non-interlaced RGB/RGBA 8-bit PNG');
  }
  const stride = width * channels;
  const inflated = inflateSync(Buffer.concat(idat));
  if (inflated.length !== height * (stride + 1)) throw Error('Source PNG dimensions/data mismatch');
  const rgba = Buffer.alloc(width * height * 4);
  let previous = Buffer.alloc(stride);
  let p = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = inflated[p++];
    const row = Buffer.alloc(stride);
    for (let x = 0; x < stride; x += 1) {
      const a = x >= channels ? row[x - channels] : 0;
      const b = previous[x];
      const c = x >= channels ? previous[x - channels] : 0;
      let predict = 0;
      if (filter === 1) predict = a;
      else if (filter === 2) predict = b;
      else if (filter === 3) predict = Math.floor((a + b) / 2);
      else if (filter === 4) {
        const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
        predict = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      } else if (filter !== 0) throw Error('Unsupported PNG row filter');
      row[x] = (inflated[p++] + predict) & 255;
    }
    for (let x = 0; x < width; x += 1) {
      const src = x * channels, dst = (y * width + x) * 4;
      rgba[dst] = row[src]; rgba[dst + 1] = row[src + 1]; rgba[dst + 2] = row[src + 2];
      rgba[dst + 3] = channels === 4 ? row[src + 3] : 255;
    }
    previous = row;
  }
  return { width, height, rgba };
}

function loadMask(bytes, width, height) {
  if (!bytes.subarray(0, 8).equals(MASK_MAGIC) || bytes.length !== 16 + width * height
    || bytes.readUInt32LE(8) !== width || bytes.readUInt32LE(12) !== height) {
    throw Error('MEZMASK1 and source PNG geometry differ');
  }
  return Buffer.from(bytes.subarray(16));
}

/** The approved front mask (3) splits abdominal ID 6 from incorrectly shared arm ID 12.
 * The original PR #409 mask has exactly 23,284 abdominal pixels carrying 12.
 * Fail loudly if source geometry changes instead of silently mislabeling anatomy.
 */
function applyApprovedFrontCorrection(mask, width) {
  let corrected = 0;
  for (let y = 421; y <= 602; y += 1) {
    for (let x = 435; x <= 585; x += 1) {
      const p = y * width + x;
      if (mask[p] === 12) { mask[p] = 6; corrected += 1; }
    }
  }
  if (corrected !== 23284) throw Error('Front anatomy source no longer matches approved mask (3)');
}

function createNeutral(source, mask, percent) {
  const { rgba } = source, length = mask.length;
  const gray = Buffer.alloc(length);
  const sums = new Float64Array(256), counts = new Uint32Array(256);
  for (let i = 0; i < length; i += 1) {
    const p = i * 4;
    if (rgba[p + 3] === 0) continue;
    const y = Math.round(0.299 * rgba[p] + 0.587 * rgba[p + 1] + 0.114 * rgba[p + 2]);
    gray[i] = y;
    if (mask[i]) { sums[mask[i]] += y; counts[mask[i]] += 1; }
  }
  const smooth = percent / 100;
  const strength = 0.12 + smooth * 0.83, detailScale = 0.72 - smooth * 0.34;
  const contrast = 0.93 - smooth * 0.08, lift = 182 + smooth * 6;
  const output = Buffer.alloc(rgba.length);
  for (let i = 0; i < length; i += 1) {
    const p = i * 4, alpha = rgba[p + 3];
    output[p + 3] = alpha;
    if (!alpha) continue;
    const base = (gray[i] - 128) * contrast + lift, id = mask[i];
    const equalized = id && counts[id] ? 186 + (gray[i] - sums[id] / counts[id]) * detailScale : base;
    const value = Math.max(0, Math.min(255, Math.round(id && counts[id] ? base * (1 - strength) + equalized * strength : base)));
    output[p] = output[p + 1] = output[p + 2] = value;
  }
  return output;
}

function blurAlpha(input, width, height) {
  const radius = 16, sigma = 5;
  const kernel = [];
  let sum = 0;
  for (let i = -radius; i <= radius; i += 1) { const v = Math.exp(-i * i / (2 * sigma * sigma)); kernel.push(v); sum += v; }
  for (let i = 0; i < kernel.length; i += 1) kernel[i] /= sum;
  const first = new Float32Array(input.length), out = new Float32Array(input.length);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    let v = 0;
    for (let j = -radius; j <= radius; j += 1) {
      const xx = x + j;
      if (xx >= 0 && xx < width) v += input[y * width + xx] * kernel[j + radius];
    }
    first[y * width + x] = v;
  }
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    let v = 0;
    for (let j = -radius; j <= radius; j += 1) {
      const yy = y + j;
      if (yy >= 0 && yy < height) v += first[yy * width + x] * kernel[j + radius];
    }
    out[y * width + x] = v;
  }
  return out;
}

function packRegions(bounds) {
  const regions = bounds.sort((a, b) => b.height - a.height || a.id - b.id);
  let x = 0, y = 0, rowHeight = 0, usedWidth = 0;
  for (const region of regions) {
    if (x && x + region.width > ATLAS_LIMIT) { x = 0; y += rowHeight + 4; rowHeight = 0; }
    if (region.width > ATLAS_LIMIT) throw Error('Oversized anatomy sprite');
    region.atlasX = x; region.atlasY = y;
    x += region.width + 4; rowHeight = Math.max(rowHeight, region.height);
    usedWidth = Math.max(usedWidth, x - 4);
  }
  return { regions, width: usedWidth, height: y + rowHeight };
}

async function buildView(view, width, height, tonePercent, version, indices, muscleNames) {
  const source = decodePng(await readFile(join(ANATOMY, `male-${view}.png`)));
  if (source.width !== width || source.height !== height) throw Error(`Image mismatch: ${view}`);
  const mask = loadMask(await readFile(join(ANATOMY, `male-${view}.mezmask`)), width, height);
  if (view === 'front') applyApprovedFrontCorrection(mask, width);
  const output = join(ANATOMY, 'atlas', `${view}-${version}`);
  await mkdir(output, { recursive: true });
  const correctedMask = Buffer.alloc(16 + mask.length);
  MASK_MAGIC.copy(correctedMask, 0);
  correctedMask.writeUInt32LE(width, 8); correctedMask.writeUInt32LE(height, 12); mask.copy(correctedMask, 16);
  await writeFile(join(output, 'mask.mezmask'), correctedMask);
  await writeFile(join(output, 'neutral.png'), encodePng(createNeutral(source, mask, tonePercent), width, height));

  const bounds = Object.keys(indices).map((rawId) => {
    const id = Number(rawId);
    return { id, x1: width, y1: height, x2: -1, y2: -1, pixels: 0 };
  });
  const byId = new Map(bounds.map((b) => [b.id, b]));
  for (let pixel = 0; pixel < mask.length; pixel += 1) {
    const rect = byId.get(mask[pixel]);
    if (!rect) continue;
    const x = pixel % width, y = Math.floor(pixel / width);
    rect.x1 = Math.min(rect.x1, x); rect.y1 = Math.min(rect.y1, y);
    rect.x2 = Math.max(rect.x2, x); rect.y2 = Math.max(rect.y2, y); rect.pixels += 1;
  }
  const active = bounds.filter((b) => b.pixels > 0).map((b) => {
    const left = Math.max(0, b.x1 - EDGE_PADDING), top = Math.max(0, b.y1 - EDGE_PADDING);
    const right = Math.min(width, b.x2 + EDGE_PADDING + 1), bottom = Math.min(height, b.y2 + EDGE_PADDING + 1);
    return { ...b, targetX: left, targetY: top, width: right - left, height: bottom - top };
  });
  const packed = packRegions(active);
  const color = Buffer.alloc(packed.width * packed.height * 4);
  const glow = Buffer.alloc(color.length);
  const sprites = {};
  for (const region of packed.regions) {
    const { id, targetX, targetY, width: sw, height: sh, atlasX, atlasY } = region;
    const alphaMask = new Uint8Array(sw * sh);
    for (let y = 0; y < sh; y += 1) for (let x = 0; x < sw; x += 1) {
      const sourcePixel = (targetY + y) * width + targetX + x;
      if (mask[sourcePixel] !== id) continue;
      alphaMask[y * sw + x] = 1;
      const dst = ((atlasY + y) * packed.width + atlasX + x) * 4;
      const src = sourcePixel * 4;
      color[dst] = source.rgba[src]; color[dst + 1] = source.rgba[src + 1];
      color[dst + 2] = source.rgba[src + 2]; color[dst + 3] = source.rgba[src + 3];
    }
    const soft = blurAlpha(alphaMask, sw, sh);
    for (let y = 0; y < sh; y += 1) for (let x = 0; x < sw; x += 1) {
      const a = Math.min(255, Math.round(soft[y * sw + x] * 46));
      if (!a) continue;
      const dst = ((atlasY + y) * packed.width + atlasX + x) * 4;
      glow[dst] = 74; glow[dst + 1] = 199; glow[dst + 2] = 255; glow[dst + 3] = a;
    }
    sprites[id] = {
      index: id, id: indices[id], label: muscleNames.get(indices[id]) ?? indices[id],
      targetX, targetY, width: sw, height: sh, atlasX, atlasY, pixels: region.pixels,
    };
  }
  await writeFile(join(output, 'color-atlas.png'), encodePng(color, packed.width, packed.height));
  await writeFile(join(output, 'glow-atlas.png'), encodePng(glow, packed.width, packed.height));
  await writeFile(join(output, 'manifest.json'), JSON.stringify({
    version, view, width, height, tonePercent, atlasWidth: packed.width, atlasHeight: packed.height, sprites,
  }, null, 2));
  process.stdout.write(`Generated ${view}: ${Object.keys(sprites).length} zones, ${packed.width}x${packed.height} atlas\n`);
}

// The checked-in catalogue is deliberately the single name/ID mapping source.
const catalogue = await readFile(join(ROOT, 'src', 'workout', 'workedMuscleData.ts'), 'utf8');
const viewMatch = catalogue.match(/export const WORKED_MUSCLE_VIEWS = (\{[\s\S]*?\}) as const;/);
const namesMatch = catalogue.match(/export const WORKED_MUSCLES = (\[[\s\S]*?\]) as const;/);
if (!viewMatch || !namesMatch) throw Error('Cannot read authoritative muscle IDs from workedMuscleData.ts');
const configs = JSON.parse(viewMatch[1]);
const names = new Map(JSON.parse(namesMatch[1]).map((m) => [m.id, m.label]));
for (const [view, tonePercent, version] of [['front', 84, 'v3'], ['rear', 59, 'v1']]) {
  const { width, height, indices } = configs[view];
  await buildView(view, width, height, tonePercent, version, indices, names);
}
