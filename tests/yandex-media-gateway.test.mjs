import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { handler } = require('../infra/yandex-media-gateway/index.js');

describe('Yandex media gateway bootstrap', () => {
  it.each([
    ['GET', {}],
    ['POST', { httpMethod: 'POST', body: '{"key":"foreign-object.mp4"}' }],
    ['OPTIONS', { httpMethod: 'OPTIONS' }],
  ])('does not issue any media capability for %s', async (_label, event) => {
    const result = await handler(event);
    expect(result.statusCode).toBe(503);
    expect(result.headers['Cache-Control']).toBe('no-store');
    expect(JSON.parse(result.body)).toEqual({ code: 'MEDIA_GATEWAY_NOT_CONFIGURED' });
    expect(result.body).not.toContain('http');
    expect(result.body).not.toContain('X-Amz-');
  });
});
