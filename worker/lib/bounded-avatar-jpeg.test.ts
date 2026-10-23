import { describe, expect, it } from 'vitest';
import { isBoundedJpeg } from './bounded-avatar-jpeg';
import { validAvatarJpeg } from './test-fixtures/avatar-jpeg';

function bytes(): Uint8Array {
  return validAvatarJpeg.slice();
}

function sofOffset(input: Uint8Array): number {
  for (let index = 2; index < input.length - 12; index++) {
    if (input[index] === 0xff && input[index + 1] === 0xc0) return index;
  }
  throw new Error('FIXTURE_HAS_NO_SOF');
}

describe('bounded JPEG validation at privileged blob ingress', () => {
  it('accepts an actual decodable JPEG whose two dimensions are within bounds', () => {
    expect(isBoundedJpeg(bytes().buffer, 128)).toBe(true);
    expect(isBoundedJpeg(bytes().buffer, 512)).toBe(true);
  });

  it('rejects oversized dimensions even when compressed bytes are tiny', () => {
    const tall = bytes();
    const sof = sofOffset(tall);
    tall[sof + 5] = 0x02;
    tall[sof + 6] = 0x01; // 513px height in a sub-1KB image
    expect(isBoundedJpeg(tall.buffer, 512)).toBe(false);

    const wide = bytes();
    const where = sofOffset(wide);
    wide[where + 7] = 0x00;
    wide[where + 8] = 0x81; // 129px width
    expect(isBoundedJpeg(wide.buffer, 128)).toBe(false);
    expect(isBoundedJpeg(wide.buffer, 512)).toBe(true);
  });

  it('rejects fake JPEG signatures, broken segments and truncated scans', () => {
    expect(isBoundedJpeg(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new Array(48).fill(0)]).buffer, 512))
      .toBe(false);
    const brokenLength = bytes();
    brokenLength[4] = 0xff;
    brokenLength[5] = 0xff;
    expect(isBoundedJpeg(brokenLength.buffer, 512)).toBe(false);
    const truncated = bytes();
    expect(isBoundedJpeg(truncated.slice(0, -2).buffer, 512)).toBe(false);
    const trailing = new Uint8Array([...bytes(), 0]);
    expect(isBoundedJpeg(trailing.buffer, 512)).toBe(false);
  });
});
