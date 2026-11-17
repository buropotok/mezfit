import { describe, expect, it, vi } from 'vitest';
import { apply } from './cloudflare.mjs';

const account = 'a'.repeat(32);
const queue = { queue_id: 'b'.repeat(32) };
const origin = 'https://mezfit.example.com';
const bucket = 'mezfit-migration-uploads';
const token = { id: 'c'.repeat(32), value: 'test-token-material' };
const policy = { effect: 'allow' };
const notificationPath = '/event_notifications/r2/' + bucket + '/configuration';

function fixture() {
  const current = { database: null, bucket: false, queue: null, token: null, cors: null, rules: [] };
  const infra = {
    pages: async () => current.token ? [{ ...current.token, name: 'mezfit-migration-uploads-uploader' }] : [],
    get: async path => {
      if (path === '/r2/buckets/' + bucket) return current.bucket ? { name: bucket } : null;
      if (path.endsWith('/managed')) return { enabled: false };
      if (path.endsWith('/custom')) return { domains: [] };
      if (path.endsWith('/cors')) return current.cors;
      if (path === notificationPath) return { bucketName: bucket,
        queues: current.rules.length ? [{ queueId: queue.queue_id, rules: current.rules }] : [] };
      throw new Error('Unexpected read ' + path);
    },
    request: vi.fn(async (path, { body }) => {
      if (path === '/d1/database') current.database = { uuid: '01234567-8901-4123-8123-012345678901' };
      else if (path === '/r2/buckets') current.bucket = true;
      else if (path === '/queues') current.queue = queue;
      else if (path.endsWith('/cors')) current.cors = body;
      else if (path === notificationPath + '/queues/' + queue.queue_id) current.rules = body.rules;
      else if (path === '/tokens') current.token = token;
      else throw new Error('Unexpected write ' + path);
      return { result: current[path === '/tokens' ? 'token' : 'queue'] };
    }),
  };
  const deploy = { get: vi.fn(async () => null) };
  const state = () => ({ database: current.database, bucket: { bucket: current.bucket },
    queue: current.queue, token: current.token, policy });
  return { infra, deploy, state, current };
}

describe('migration bootstrap writes', () => {
  it('creates missing resources and publishes scoped credentials only once', async () => {
    const { infra, deploy, state } = fixture();
    const publish = vi.fn();
    await apply(infra, deploy, state(), account, origin, publish);
    expect(infra.request.mock.calls.map(([path, options]) => [path, options.method])).toEqual([
      ['/d1/database', 'POST'], ['/r2/buckets', 'POST'], ['/queues', 'POST'], ['/r2/buckets/' + bucket + '/cors', 'PUT'],
      [notificationPath + '/queues/' + queue.queue_id, 'PUT'], ['/tokens', 'POST'],
    ]);
    expect(publish).toHaveBeenCalledExactlyOnceWith(account, {
      MIGRATION_R2_ACCESS_KEY_ID: token.id, MIGRATION_R2_SECRET_ACCESS_KEY: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    infra.request.mockClear();
    await apply(infra, deploy, state(), account, origin, publish);
    expect(infra.request).not.toHaveBeenCalled();
    expect(publish).toHaveBeenCalledOnce();
  });

  it('fills missing settings after a partial bootstrap without recreating resources or credentials', async () => {
    const { infra, deploy, state, current } = fixture();
    Object.assign(current, { database: { uuid: '01234567-8901-4123-8123-012345678901' }, bucket: true, queue, token });
    const publish = vi.fn();
    await apply(infra, deploy, state(), account, origin, publish);
    expect(infra.request.mock.calls.map(([path]) => path)).toEqual([
      '/r2/buckets/' + bucket + '/cors', notificationPath + '/queues/' + queue.queue_id,
    ]);
    expect(publish).not.toHaveBeenCalled();
  });
});
