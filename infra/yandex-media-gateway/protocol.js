'use strict';
const { createHash, createHmac, timingSafeEqual } = require('node:crypto');

class GatewayError extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
    this.code = code;
  }
}
const fail = (status, code) => { throw new GatewayError(status, code); };
const hash = value => createHash('sha256').update(value).digest('hex');
const mac = (key, value) => createHmac('sha256', key).update('mezfit-media-v1\0').update(value).digest();
function seal(key, value) {
  const payload = Buffer.from(JSON.stringify(value)).toString('base64url');
  return payload + '.' + mac(key, payload).toString('base64url');
}
function unseal(key, proof) {
  if (typeof proof !== 'string' || !/^[\w-]+\.[\w-]{43}$/.test(proof) || proof.length > 1800) fail(403, 'INVALID_MEDIA_PROOF');
  const [payload, signature] = proof.split('.');
  if (!timingSafeEqual(mac(key, payload), Buffer.from(signature, 'base64url'))) fail(403, 'INVALID_MEDIA_PROOF');
  return JSON.parse(Buffer.from(payload, 'base64url').toString());
}
const formats = {
  'image/jpeg': ['photo', ['jpg', 'jpeg'], 20],
  'image/png': ['photo', ['png'], 20],
  'image/webp': ['photo', ['webp'], 20],
  'image/heic': ['photo', ['heic'], 20],
  'video/mp4': ['video', ['mp4'], 250],
  'video/quicktime': ['video', ['mov'], 250],
  'video/webm': ['video', ['webm'], 250],
  'audio/ogg': ['voice', ['ogg', 'opus'], 25],
  'audio/webm': ['voice', ['webm'], 25],
  'audio/mp4': ['voice', ['mp4', 'm4a'], 25],
};
function baseMime(mime) {
  return typeof mime === 'string' && mime.length <= 256 && !/[\r\n\0]/.test(mime)
    ? mime.split(';')[0].trim().toLowerCase() : '';
}
function validateMedia(row, filename) {
  const mime = baseMime(row.mimeType);
  const format = Object.hasOwn(formats, mime) ? formats[mime] : null;
  if (!format || row.mediaType !== format[0] || !Number.isSafeInteger(row.sizeBytes)
    || row.sizeBytes < 1 || row.sizeBytes > format[2] * 1024 ** 2
    || (filename !== undefined && (typeof filename !== 'string' || filename.length > 255
      || !format[1].includes(filename.split('.').pop().toLowerCase())))
    || (row.mediaType === 'photo' ? row.durationSeconds !== null
      : !Number.isFinite(row.durationSeconds) || row.durationSeconds <= 0
        || (row.mediaType === 'video' && row.durationSeconds > 180))) fail(400, 'INVALID_MEDIA');
}
function matchesContent(mime, bytes) {
  mime = baseMime(mime);
  const ascii = (a, b) => bytes.subarray(a, b).toString('ascii');
  if (mime === 'image/jpeg') return bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (mime === 'image/png') return bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  if (mime === 'image/webp') return ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP';
  if (mime === 'audio/ogg') return ascii(0, 4) === 'OggS';
  if (mime.endsWith('/webm')) return bytes.subarray(0, 4).equals(Buffer.from([26,69,223,163]));
  if (ascii(4, 8) !== 'ftyp') return false;
  const brand = ascii(8, 12);
  if (mime === 'image/heic') return ['heic','heix','hevc','hevx','mif1'].includes(brand);
  if (mime === 'video/quicktime') return brand === 'qt  ';
  return ['isom','iso2','mp41','mp42','M4A ','M4V ','avc1','dash'].includes(brand);
}
module.exports = { GatewayError, fail, hash, seal, unseal, validateMedia, matchesContent };
