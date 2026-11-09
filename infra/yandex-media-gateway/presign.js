'use strict';
const http2 = require('node:http2');
const { fail } = require('./protocol');

// yandex/cloud/storage/v1/presign_service.proto. One unary request and one URL.
function varint(value) {
  const bytes = [];
  do {
    bytes.push((value & 127) | (value > 127 ? 128 : 0));
    value = Math.floor(value / 128);
  } while (value);
  return Buffer.from(bytes);
}
function field(number, value) {
  const bytes = Buffer.from(value);
  return Buffer.concat([varint(number * 8 + 2), varint(bytes.length), bytes]);
}
function encodeRequest(bucket, key, method, headers, ttl) {
  const object = Buffer.concat([Buffer.from([8]), varint(ttl), field(2, key), field(3, method),
    ...Object.entries(headers).map(([name, value]) => field(4, Buffer.concat([field(1, name), field(2, value)])))]);
  return Buffer.concat([field(1, bucket), field(3, object)]);
}
function decodeResponse(frame) {
  if (frame.length < 7 || frame[0] !== 0 || frame.readUInt32BE(1) !== frame.length - 5 || frame[5] !== 10)
    fail(502, 'INVALID_SIGNER_RESPONSE');
  let length = 0, shift = 0, offset = 6;
  while (true) {
    if (offset >= frame.length || shift > 28) fail(502, 'INVALID_SIGNER_RESPONSE');
    const byte = frame[offset++];
    length += (byte & 127) * 2 ** shift;
    if (!(byte & 128)) break;
    shift += 7;
  }
  if (offset + length !== frame.length) fail(502, 'INVALID_SIGNER_RESPONSE');
  return frame.subarray(offset).toString();
}
async function presign(token, bucket, key, method, headers, ttl) {
  const payload = encodeRequest(bucket, key, method, headers, ttl);
  const prefix = Buffer.alloc(5);
  prefix.writeUInt32BE(payload.length, 1);
  const frame = await new Promise((resolve, reject) => {
    const session = http2.connect('https://storage.api.cloud.yandex.net');
    let done = false, stream;
    function finish(error, value) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      session.destroy();
      if (error) reject(error);
      else resolve(value);
    }
    const timer = setTimeout(() => finish(new Error('SIGNER_TIMEOUT')), 8000);
    session.on('error', finish);
    try {
      stream = session.request({ ':method': 'POST', ':path': '/yandex.cloud.storage.v1.PresignService/Create',
        'content-type': 'application/grpc', te: 'trailers', authorization: 'Bearer ' + token, 'grpc-timeout': '8S' });
    } catch (error) { finish(error); return; }
    const chunks = [];
    let length = 0, status, grpcStatus;
    stream.on('response', h => { status = h[':status']; grpcStatus = h['grpc-status']; });
    stream.on('trailers', h => { grpcStatus = h['grpc-status']; });
    stream.on('error', finish);
    stream.on('data', bytes => {
      length += bytes.length;
      if (length > 32768) finish(new Error('SIGNER_RESPONSE_LIMIT'));
      else chunks.push(bytes);
    });
    stream.on('end', () => status === 200 && String(grpcStatus) === '0'
      ? finish(null, Buffer.concat(chunks)) : finish(new Error('SIGNER_REJECTED')));
    stream.end(Buffer.concat([prefix, payload]));
  }).catch(() => fail(502, 'SIGNER_UNAVAILABLE'));
  const url = new URL(decodeResponse(frame));
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash || !url.search
    || !((url.hostname === 'storage.yandexcloud.net' && url.pathname === '/' + bucket + '/' + key)
      || (url.hostname === bucket + '.storage.yandexcloud.net' && url.pathname === '/' + key)))
    fail(502, 'INVALID_SIGNER_RESPONSE');
  return url.href;
}
module.exports = { presign, encodeRequest, decodeResponse };
