import { describe, expect, it } from 'vitest';
import {
  diagnosePublicCatalogueRest,
  parseReadOnlyCredentials,
  renderPublicCatalogueRestReport,
} from './diagnose-public-catalogue-rest.mjs';

const dbUrl = 'https://zjv60oxag.dexie.cloud';
const credentials = { clientId: 'test-client', clientSecret: 'test-very-private' };
const sha = '5ce3e6b15117e115a1e10ac31573eb85eea6bf284a72971e5ca1ee02572aa40c';

function fakeServer({ missing = [], empty = [], badTable = null, tokenStatus = 200, tableStatus = 200 } = {}) {
  const calls = [];
  const fetchFn = async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('/token')) {
      return {
        ok: tokenStatus === 200, status: tokenStatus,
        json: async () => ({ accessToken: 'test-access-token' }),
      };
    }
    const table = new URL(url).pathname.split('/').at(-1);
    if (missing.includes(table)) return { ok: false, status: 404 };
    if (tableStatus !== 200) return { ok: false, status: tableStatus };
    if (badTable === table) return { ok: true, status: 200, json: async () => ({ unknown: 12 }) };
    if (empty.includes(table)) return { ok: true, status: 200, json: async () => [] };
    const rows = table === 'publicExerciseDefinitions'
      ? Array.from({ length: 1324 }, (_, i) => ({ id: String(i).padStart(4, '0'), realmId: 'rlm-public' }))
      : table === 'publicExerciseTaxonomy'
        ? Array.from({ length: 69 }, (_, i) => ({ id: String(i), realmId: 'rlm-public' }))
        : [{ id: 'mezfit:exercise-catalogue', realmId: 'rlm-public', owner: null,
          schemaVersion: '2.0.0', sourceSha256: sha, exerciseCount: 1324, taxonomyCount: 69 }];
    return { ok: true, status: 200, json: async () => rows };
  };
  return { calls, fetchFn };
}

describe('Dexie public catalogue GLOBAL_READ REST diagnostics', () => {
  it('uses token scopes ACCESS_DB + GLOBAL_READ and exclusively reads rlm-public', async () => {
    const server = fakeServer();
    const result = await diagnosePublicCatalogueRest({ dbUrl, credentials, fetchFn: server.fetchFn });
    expect(result.countsMatch).toBe(true);
    expect(result.manifest).toBe('matches');
    expect(server.calls).toHaveLength(4);
    const [token, ...queries] = server.calls;
    expect(token.url).toBe(dbUrl + '/token');
    expect(token.options.method).toBe('POST');
    const body = JSON.parse(token.options.body);
    expect(body).toEqual({
      grant_type: 'client_credentials', scopes: ['ACCESS_DB', 'GLOBAL_READ'],
      client_id: credentials.clientId, client_secret: credentials.clientSecret,
    });
    for (const query of queries) {
      expect(query.options.method).toBe('GET');
      expect(query.options.headers.authorization).toBe('Bearer test-access-token');
      expect(new URL(query.url).searchParams.get('realmId')).toBe('rlm-public');
      expect(new URL(query.url).pathname).toMatch(/^\/all\/publicExercise/);
    }
    const report = renderPublicCatalogueRestReport(result);
    expect(report).toContain('1324');
    expect(report).toContain('Publication manifest: matches');
    expect(report).not.toContain('test-access-token');
    expect(report).not.toContain('test-very-private');
    expect(report).not.toContain('test-client');
  });

  it('reports unknown when the remote table is 404, not a false empty table', async () => {
    const { fetchFn } = fakeServer({ missing: ['publicExerciseTaxonomy', 'publicExerciseCatalogues'] });
    const result = await diagnosePublicCatalogueRest({ dbUrl, credentials, fetchFn });
    expect(result.tables.publicExerciseTaxonomy).toEqual({ status: 'unavailable', count: null });
    expect(result.manifest).toBe('unknown');
    expect(result.countsMatch).toBe(false);
    expect(renderPublicCatalogueRestReport(result)).toContain('unknown');
  });

  it('distinguishes a successful empty table from an unavailable (404) table', async () => {
    const { fetchFn } = fakeServer({ empty: ['publicExerciseDefinitions', 'publicExerciseCatalogues'] });
    const result = await diagnosePublicCatalogueRest({ dbUrl, credentials, fetchFn });
    expect(result.tables.publicExerciseDefinitions).toEqual({ status: 'ok', count: 0 });
    expect(result.manifest).toBe('absent');
    expect(result.countsMatch).toBe(false);
  });

  it('fails closed on permission failures and unexpected data', async () => {
    await expect(diagnosePublicCatalogueRest({
      dbUrl, credentials, fetchFn: fakeServer({ tokenStatus: 403 }).fetchFn,
    })).rejects.toThrow('token request failed (HTTP 403)');
    await expect(diagnosePublicCatalogueRest({
      dbUrl, credentials, fetchFn: fakeServer({ tableStatus: 403 }).fetchFn,
    })).rejects.toThrow('publicExerciseDefinitions failed (HTTP 403)');
    await expect(diagnosePublicCatalogueRest({
      dbUrl, credentials, fetchFn: fakeServer({ badTable: 'publicExerciseDefinitions' }).fetchFn,
    })).rejects.toThrow('unexpected public records');
  });

  it('validates credential JSON, correct database mapping and safe destination URL', async () => {
    const raw = JSON.stringify({ [dbUrl]: credentials });
    expect(parseReadOnlyCredentials(raw, dbUrl)).toEqual(credentials);
    expect(() => parseReadOnlyCredentials('not JSON', dbUrl)).toThrow('not valid JSON');
    expect(() => parseReadOnlyCredentials(raw, 'https://other.dexie.cloud')).toThrow('does not contain');
    const server = fakeServer();
    await expect(diagnosePublicCatalogueRest({
      dbUrl: 'https://malicious.invalid', credentials, fetchFn: server.fetchFn,
    })).rejects.toThrow('database URL is invalid');
    expect(server.calls).toHaveLength(0);
  });
});
