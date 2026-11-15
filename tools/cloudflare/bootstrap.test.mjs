import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CloudflareApi, desiredCors, provisionInfrastructure, sameCors, validateOrigin } from './bootstrap.mjs';
import { collectWorkerSecrets } from './worker-secrets.mjs';

const accountId = 'a'.repeat(32);
const uuid = 'e90e1e0e-1111-4111-8111-abcdef123456';
const origin = 'https://mezfit.example.com';
const media = 'mezfit-discussion-media';
const accessId = 'b'.repeat(32);
const tokenValue = 'test-only-token-value';

function fixture({ db = false, buckets = [], cors, token = false } = {}) {
  const state = {
    db, buckets: new Set(buckets), cors: cors ?? { rules: [] }, token, changes: [],
  };
  const api = {
    accountId,
    path: suffix => '/accounts/' + accountId + suffix,
    async pages(suffix) {
      if (suffix === '/d1/database') return state.db ? [{ name: 'mezfit', uuid }] : [];
      if (suffix === '/tokens') return state.token ? [{ name: 'mezfit-discussion-media-uploader', id: accessId }] : [];
      throw new Error('Unexpected list ' + suffix);
    },
    async request(route, options = {}) {
      const method = options.method ?? 'GET';
      if (method !== 'GET') state.changes.push([method, route, options.body]);
      if (route.includes('/tokens/permission_groups?')) return {
        result: [{ name: 'Workers R2 Storage Bucket Item Write', id: 'c'.repeat(32),
          scopes: ['com.cloudflare.edge.r2.bucket'] }],
      };
      if (route.endsWith('/d1/database') && method === 'POST') {
        state.db = true;
        return { result: { name: 'mezfit', uuid } };
      }
      if (route.endsWith('/r2/buckets') && method === 'POST') {
        state.buckets.add(options.body.name);
        return { result: { name: options.body.name } };
      }
      if (route.endsWith('/r2/buckets/' + media + '/cors')) {
        if (method === 'PUT') state.cors = options.body;
        return { result: state.cors };
      }
      if (route.endsWith('/tokens') && method === 'POST') {
        state.token = true;
        return { result: { id: accessId, value: tokenValue } };
      }
      const bucket = route.split('/r2/buckets/')[1];
      if (bucket && state.buckets.has(bucket)) return { result: { name: bucket } };
      if (options.optional404) return null;
      throw new Error('Missing mocked resource ' + route);
    },
  };
  return { api, state };
}

describe('Cloudflare infrastructure bootstrap', () => {
  it('uses exact HTTPS application origin without query, path or credentials', () => {
    expect(validateOrigin(origin)).toBe(origin);
    expect(() => validateOrigin('http://mezfit.example.com')).toThrow();
    expect(() => validateOrigin(origin + '/nested')).toThrow();
    expect(() => validateOrigin('https://user:pass@mezfit.example.com')).toThrow();
    expect(() => validateOrigin('https://mezfit.example.com?redirect=evil')).toThrow();
    expect(desiredCors(origin).rules[0].allowed.methods).toContain('PUT');
  });

  it('preview plans missing resources without issuing any writes', async () => {
    const { api, state } = fixture();
    const preview = await provisionInfrastructure(api, { origin, mode: 'preview' });
    expect(preview.databaseId).toBeNull();
    expect(preview.actions).toContain('create D1 mezfit');
    expect(preview.actions).toContain('create R2 mezfit');
    expect(preview.actions).toContain('create R2 ' + media);
    expect(preview.actions).toContain('configure discussion R2 CORS');
    expect(preview.actions).toContain('create scoped discussion R2 S3 token');
    expect(state.changes).toEqual([]);
  });

  it('creates resources and bucket-scoped token, then passes exact readback', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'mezfit-cloudflare-test-'));
    try {
      const file = join(directory, 'credentials.json');
      const { api, state } = fixture();
      const result = await provisionInfrastructure(api, {
        origin, mode: 'apply', credentialsFile: file,
      });
      expect(result.databaseId).toBe(uuid);
      expect(result.newR2Token).toBe(true);
      expect(state.buckets.has(media)).toBe(true);
      expect(state.changes.filter(([method]) => method === 'POST')).toHaveLength(4);
      const tokenRequest = state.changes.find(([method, route]) => method === 'POST' && route.endsWith('/tokens'))[2];
      expect(tokenRequest.policies[0].resources).toEqual({
        ['com.cloudflare.edge.r2.bucket.' + accountId + '_default_' + media]: '*',
      });
      expect(tokenRequest.policies[0].permission_groups[0].name).toBe('Workers R2 Storage Bucket Item Write');
      const generated = JSON.parse(await readFile(file, 'utf8'));
      expect(generated).toMatchObject({ R2_ACCOUNT_ID: accountId, R2_MEDIA_ACCESS_KEY_ID: accessId,
        R2_MEDIA_SECRET_ACCESS_KEY: expect.stringMatching(/^[a-f0-9]{64}$/) });
      expect(JSON.stringify(state.changes)).not.toContain(tokenValue);

      const again = await provisionInfrastructure(api, { origin, mode: 'apply' });
      expect(again.actions).toEqual([]);
      expect(again.newR2Token).toBe(false);
      expect(state.changes.filter(([method]) => method === 'POST')).toHaveLength(4);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('does not overwrite different existing CORS without distinct explicit permission', async () => {
    const { api, state } = fixture({ db: true, buckets: ['mezfit', media],
      cors: { rules: [{ id: 'customer-rule', allowed: { origins: ['https://another.example'],
        methods: ['GET'], headers: [] } }] }, token: true });
    const preview = await provisionInfrastructure(api, { origin, mode: 'preview' });
    expect(preview.state.corsState).toBe('conflict');
    await expect(provisionInfrastructure(api, { origin, mode: 'apply' }))
      .rejects.toThrow('EXISTING_R2_CORS_REQUIRES_EXPLICIT_APPROVAL');
    expect(state.changes).toEqual([]);
    const changed = await provisionInfrastructure(api, { origin, mode: 'apply', replaceExistingCors: true });
    expect(changed.state.corsState).toBe('current');
    expect(state.changes.map(([method]) => method)).toEqual(['PUT']);
  });

  it('detects CORS configuration independently of method and header order', () => {
    const expected = desiredCors(origin);
    const received = structuredClone(expected);
    received.rules[0].allowed.methods.reverse();
    received.rules[0].allowed.headers.reverse();
    expect(sameCors(received, expected)).toBe(true);
    received.rules[0].allowed.origins = ['https://different.example'];
    expect(sameCors(received, expected)).toBe(false);
  });

  it('fails closed for unexpected Cloudflare HTTP and response envelopes', async () => {
    const fetchApi = vi.fn().mockResolvedValueOnce(new Response(null, { status: 403 }))
      .mockResolvedValueOnce(Response.json({ success: false, errors: [{ message: 'secret data' }] }));
    const api = new CloudflareApi(accountId, 'test', fetchApi);
    await expect(api.request(api.path('/d1/database'))).rejects.toThrow('HTTP_403');
    await expect(api.request(api.path('/d1/database'))).rejects.toThrow('CLOUDFLARE_API_UNSUCCESSFUL');
    expect(fetchApi).toHaveBeenCalledTimes(2);
  });
});

describe('Worker secret collection', () => {
  it('requires only the actual external bootstrap secret, preserves optional values and imported R2 token', () => {
    expect(() => collectWorkerSecrets({})).toThrow('TELEGRAM_BOT_TOKEN_REPOSITORY_SECRET_REQUIRED');
    expect(collectWorkerSecrets({
      TELEGRAM_BOT_TOKEN: 'telegram-private',
      DEXIE_CLOUD_CLIENT_ID: 'id-private',
      DEXIE_CLOUD_CLIENT_SECRET: '',
    }, {
      R2_ACCOUNT_ID: accountId,
      R2_MEDIA_ACCESS_KEY_ID: accessId,
      R2_MEDIA_SECRET_ACCESS_KEY: 'private',
    })).toEqual({
      TELEGRAM_BOT_TOKEN: 'telegram-private',
      DEXIE_CLOUD_CLIENT_ID: 'id-private',
      R2_ACCOUNT_ID: accountId,
      R2_MEDIA_ACCESS_KEY_ID: accessId,
      R2_MEDIA_SECRET_ACCESS_KEY: 'private',
    });
    expect(() => collectWorkerSecrets({ TELEGRAM_BOT_TOKEN: 'test' },
      { R2_ACCOUNT_ID: accountId })).toThrow('GENERATED_R2_CREDENTIALS_INCOMPLETE');
  });
});
