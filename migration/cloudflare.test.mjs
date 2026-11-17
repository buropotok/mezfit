import { afterEach, describe, expect, it, vi } from 'vitest';
import { CloudflareApi, inspectBucket } from './cloudflare.mjs';

const account = 'a'.repeat(32);
const bucket = 'mezfit-migration-uploads';
const queue = { queue_id: 'b'.repeat(32) };
const origin = 'https://mezfit.example.com';
const bucketPath = '/r2/buckets/' + bucket;
const notificationsPath = '/event_notifications/r2/' + bucket + '/configuration';

function cloudflareError(status, ...codes) {
  return Response.json({ success: false, errors: codes.map(code => ({ code })), result: null }, { status });
}

function mockApi(notificationResponse) {
  const resources = {
    [bucketPath]: { name: bucket, jurisdiction: 'default' },
    [bucketPath + '/domains/managed']: { enabled: false },
    [bucketPath + '/domains/custom']: { domains: [] },
    [bucketPath + '/cors']: { rules: [] },
  };
  vi.stubGlobal('fetch', vi.fn(async (url, { method }) => {
    const path = new URL(url).pathname.replace('/client/v4/accounts/' + account, '');
    if (method === 'GET' && Object.hasOwn(resources, path)) {
      return Response.json({ success: true, result: resources[path] });
    }
    return notificationResponse();
  }));
  return new CloudflareApi(account, 'test-bootstrap-token', 'CLOUDFLARE_BOOTSTRAP_API_TOKEN');
}

afterEach(() => vi.unstubAllGlobals());

describe('migration R2 notification inspection', () => {
  it('recognizes an existing bucket with no notification configuration', async () => {
    const api = mockApi(() => cloudflareError(404, 11015));

    await expect(inspectBucket(api, queue, origin)).resolves.toEqual({
      bucket: true, private: true, cors: 'missing', notifications: 'missing',
    });
  });

  it('recognizes a rule already configured for the migration queue', async () => {
    const api = mockApi(() => Response.json({
      success: true,
      result: {
        bucketName: bucket,
        queues: [{
          queueId: queue.queue_id,
          rules: [{ actions: ['PutObject', 'CopyObject', 'CompleteMultipartUpload'] }],
        }],
      },
    }));

    await expect(inspectBucket(api, queue, origin)).resolves.toMatchObject({ notifications: 'current' });
  });

  it.each([
    [401, [11015]],
    [403, [11015]],
    [404, [10007]],
    [404, [11015, 9109]],
    [500, [11015]],
  ])('propagates HTTP %i with unexpected Cloudflare error codes %j', async (status, codes) => {
    const api = mockApi(() => cloudflareError(status, ...codes));

    await expect(inspectBucket(api, queue, origin)).rejects.toThrow(
      'failed with HTTP ' + status + ' (Cloudflare codes: ' + codes.join(', ') + ')',
    );
  });

  it('propagates a malformed 404 response', async () => {
    const api = mockApi(() => new Response('not JSON', { status: 404 }));

    await expect(inspectBucket(api, queue, origin)).rejects.toThrow('failed with HTTP 404');
  });

  it('rejects an invalid success response', async () => {
    const api = mockApi(() => Response.json({ success: true, result: null }));

    await expect(inspectBucket(api, queue, origin)).rejects.toThrow('MIGRATION_BUCKET_SETTINGS_RESPONSE_INVALID');
  });

  it('propagates the same 404 from other routes and write requests', async () => {
    const api = mockApi(() => cloudflareError(404, 11015));

    await expect(api.get('/queues/' + queue.queue_id)).rejects.toThrow('HTTP 404 (Cloudflare codes: 11015)');
    await expect(api.request(notificationsPath, { method: 'PUT' })).rejects.toThrow('HTTP 404 (Cloudflare codes: 11015)');
  });
});
