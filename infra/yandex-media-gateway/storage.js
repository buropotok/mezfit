'use strict';
const { createHash } = require('node:crypto');
const { fail, hash } = require('./protocol');
const { presign } = require('./presign');

function createStorage(fetchImpl, bucket, token) {
  if (!token) fail(503, 'RUNTIME_IDENTITY_UNAVAILABLE');
  async function request(key, method, headers = {}, body, query = '') {
    const response = await fetchImpl('https://storage.yandexcloud.net/' + bucket + '/' + key + query, {
      method, body, redirect: 'error', signal: AbortSignal.timeout(8000),
      headers: { Authorization: 'Bearer ' + token, ...headers },
    });
    if (response.ok) return response;
    await response.body?.cancel();
    if (response.status === 404) return null;
    if (response.status === 403) fail(503, 'STORAGE_PERMISSION_DENIED');
    if (response.status === 412) fail(409, 'UPLOAD_CONFLICT');
    fail(502, 'STORAGE_UNAVAILABLE');
  }
  async function head(key) {
    const response = await request(key, 'HEAD');
    if (!response) return null;
    return { size: Number(response.headers.get('content-length')), mime: response.headers.get('content-type'),
      etag: response.headers.get('etag'), modified: response.headers.get('last-modified'),
      proof: response.headers.get('x-amz-meta-mezfit-proof') };
  }
  const marker = key => 'media/revoked/' + hash(key);
  return {
    head,
    sign: (key, method, headers, ttl) => presign(token, bucket, key, method, headers, ttl),
    revoked: key => head(marker(key)),
    async sample(key, etag) {
      const response = await request(key, 'GET', { Range: 'bytes=0-63', 'If-Match': etag });
      if (!response) fail(409, 'UPLOAD_MISSING');
      if (response.status !== 206 || !response.body || Number(response.headers.get('content-length')) > 64) {
        await response.body?.cancel();
        fail(502, 'STORAGE_RANGE_REQUIRED');
      }
      const reader = response.body.getReader();
      const chunks = [];
      let size = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) return Buffer.concat(chunks);
          size += value.length;
          if (size > 64) fail(502, 'INVALID_STORAGE_RESPONSE');
          chunks.push(Buffer.from(value));
        }
      } finally {
        await reader.cancel();
        reader.releaseLock();
      }
    },
    async revoke(key, proof) {
      const response = await request(marker(key), 'PUT', { 'x-amz-meta-mezfit-proof': proof }, Buffer.alloc(0));
      if (!response) fail(502, 'STORAGE_UNAVAILABLE');
      await response.body?.cancel();
    },
    async remove(key) {
      const response = await request(key, 'DELETE');
      await response?.body?.cancel();
    },
    async retain(key) {
      const tags = '<Tagging xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><TagSet><Tag><Key>mezfit-upload</Key><Value>confirmed</Value></Tag></TagSet></Tagging>';
      const response = await request(key, 'PUT', { 'Content-Type': 'application/xml',
        'Content-MD5': createHash('md5').update(tags).digest('base64') }, tags, '?tagging');
      if (!response) fail(409, 'UPLOAD_MISSING');
      await response.body?.cancel();
    },
  };
}
module.exports = { createStorage };
