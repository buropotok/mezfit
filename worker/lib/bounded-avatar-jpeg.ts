/**
 * Validate bounded JPEG envelope before trusting browser-uploaded image bytes.
 * Canvas encodes baseline JPEG; parse framing/segments/scan markers ourselves
 * instead of using a Cloudflare image decoder or trusting the supplied MIME.
 * This checks dimensions and truncation, but does not decode DCT coefficients.
 */
export function isBoundedJpeg(source: ArrayBufferLike, maxSide: number): boolean {
  const bytes = new Uint8Array(source);
  if (bytes.length < 32 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return false;
  let pos = 2;
  let frame = false;
  let scans = 0;
  let inScan = false;
  let hasQuantization = false;
  let hasHuffman = false;

  while (pos < bytes.length) {
    if (inScan) {
      let hasEntropy = false;
      let ended = false;
      while (pos < bytes.length) {
        if (bytes[pos] !== 0xff) {
          hasEntropy = true;
          pos++;
          continue;
        }
        const start = pos;
        while (pos < bytes.length && bytes[pos] === 0xff) pos++;
        if (pos >= bytes.length) return false;
        const marker = bytes[pos++];
        if (marker === 0x00) {
          hasEntropy = true;
          continue;
        }
        if (marker >= 0xd0 && marker <= 0xd7) continue;
        pos = start;
        ended = true;
        break;
      }
      if (!ended || !hasEntropy) return false;
      inScan = false;
      continue;
    }

    if (bytes[pos++] !== 0xff) return false;
    while (pos < bytes.length && bytes[pos] === 0xff) pos++;
    if (pos >= bytes.length) return false;
    const marker = bytes[pos++];
    if (marker === 0xd9) {
      return pos === bytes.length && frame && scans > 0 && hasQuantization && hasHuffman;
    }
    if (marker === 0xd8 || marker === 0x00 || marker === 0x01
      || marker >= 0xd0 && marker <= 0xd7) return false;
    if (pos + 2 > bytes.length) return false;
    const segmentLength = bytes[pos] * 256 + bytes[pos + 1];
    if (segmentLength < 2 || pos + segmentLength > bytes.length) return false;
    const start = pos + 2;
    const end = pos + segmentLength;

    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      if (frame || marker !== 0xc0 || segmentLength < 11 || bytes[start] !== 8) return false;
      const height = bytes[start + 1] * 256 + bytes[start + 2];
      const width = bytes[start + 3] * 256 + bytes[start + 4];
      const components = bytes[start + 5];
      if (width < 1 || width > maxSide || height < 1 || height > maxSide
        || components < 1 || components > 4 || segmentLength !== 8 + 3 * components) return false;
      frame = true;
    }
    if (marker === 0xdb) hasQuantization = true;
    if (marker === 0xc4) hasHuffman = true;
    if (marker === 0xda) {
      if (!frame || segmentLength < 6 || !hasQuantization || !hasHuffman) return false;
      const components = bytes[start];
      if (components < 1 || components > 4 || segmentLength !== 6 + 2 * components) return false;
      scans++;
      inScan = true;
    }
    pos = end;
  }
  return false;
}
