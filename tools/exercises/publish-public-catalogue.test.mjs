import { describe, expect, it } from 'vitest';
import {
  executePreparedPublication, openPublicSession, publicationPlan, runPublicCatalogue,
} from './publish-public-catalogue.mjs';

const dbUrl = 'https://zjv60oxag.dexie.cloud';
const creds = { clientId: 'fake-client', clientSecret: 'private-test-secret' };
const rawKey = JSON.stringify({ [dbUrl]: creds });
const REALM = 'rlm-public';

function canonicalFixture() {
  const definitions = Object.fromEntries(Array.from({ length: 1324 }, (_, i) => {
    const id = String(i + 1).padStart(4, '0');
    return [id, { id, realmId: REALM, owner: null, sourceSha256: 'fixture', name: 'Example' }];
  }));
  const taxonomy = Object.fromEntries(Array.from({ length: 69 }, (_, i) => {
    const id = 'tax-' + i;
    return [id, { id, realmId: REALM, owner: null, sourceSha256: 'fixture', kind: 'zone' }];
  }));
  const manifest = {
    id: 'mezfit:exercise-catalogue', realmId: REALM, owner: null,
    schemaVersion: '2.0.0', sourceSha256: 'fixture',
    exerciseCount: 1324, taxonomyCount: 69, publishedAt: '2026-10-14T00:00:00.000Z',
  };
  const prepared = { stage: { data: { [REALM]: {
    publicExerciseDefinitions: definitions, publicExerciseTaxonomy: taxonomy,
  } } }, activate: { data: { [REALM]: { publicExerciseCatalogues: {
    [manifest.id]: manifest,
  } } } } };
  return { prepared, definitions, taxonomy, manifest };
}

function cloud(initial = {}, { failOnPut = 0, tamperReadback = false } = {}) {
  const values = {
    publicExerciseDefinitions: new Map((initial.publicExerciseDefinitions || []).map(row => [row.id, row])),
    publicExerciseTaxonomy: new Map((initial.publicExerciseTaxonomy || []).map(row => [row.id, row])),
    publicExerciseCatalogues: new Map((initial.publicExerciseCatalogues || []).map(row => [row.id, row])),
  };
  const writes = [];
  const session = {
    async list(name) {
      const rows = Array.from(values[name].values());
      if (tamperReadback && writes.length && name === 'publicExerciseDefinitions') {
        return rows.map((row, index) => index === 0 ? { ...row, name: 'Tampered' } : row);
      }
      return rows;
    },
    async put(name, rows) {
      writes.push({ table: name, count: rows.length });
      if (failOnPut && writes.length === failOnPut) throw new Error('Service unavailable');
      for (const row of rows) values[name].set(row.id, row);
    },
  };
  return { session, writes, values };
}

describe('guarded public catalogue publication', () => {
  it('plans additive first release without replacing private records or deleting anything', () => {
    const { prepared } = canonicalFixture();
    const result = publicationPlan({
      publicExerciseDefinitions: [], publicExerciseTaxonomy: [], publicExerciseCatalogues: [],
    }, prepared);
    expect(result.missing.publicExerciseDefinitions).toHaveLength(1324);
    expect(result.missing.publicExerciseTaxonomy).toHaveLength(69);
    expect(result.alreadyActive).toBe(false);
    expect(result.existingCounts.publicExerciseCatalogues).toBe(0);
  });

  it('rejects conflicting or unexpected existing records before any write', () => {
    const { prepared, definitions } = canonicalFixture();
    const normal = { publicExerciseTaxonomy: [], publicExerciseCatalogues: [] };
    expect(() => publicationPlan({
      ...normal, publicExerciseDefinitions: [{ ...definitions['0001'], name: 'Other' }],
    }, prepared)).toThrow('Conflicting existing public row');
    expect(() => publicationPlan({
      ...normal, publicExerciseDefinitions: [{ id: 'foreign', realmId: REALM }],
    }, prepared)).toThrow('Unexpected existing public row');
  });

  it('writes only missing canonical rows, verifies both tables and writes the manifest last', async () => {
    const { prepared } = canonicalFixture();
    const db = cloud();
    const current = {
      publicExerciseDefinitions: [], publicExerciseTaxonomy: [], publicExerciseCatalogues: [],
    };
    const result = await executePreparedPublication({
      session: db.session, prepared, plan: publicationPlan(current, prepared), backupApproved: true,
    });
    expect(result.status).toBe('published');
    expect(result.manifest).toBe('verified');
    expect(db.values.publicExerciseDefinitions.size).toBe(1324);
    expect(db.values.publicExerciseTaxonomy.size).toBe(69);
    expect(db.values.publicExerciseCatalogues.size).toBe(1);
    expect(db.writes.at(-1)).toEqual({ table: 'publicExerciseCatalogues', count: 1 });
    expect(db.writes.slice(0, -1).every(write => write.count <= 25)).toBe(true);
  });

  it('refuses every mutation without confirmed private backup', async () => {
    const { prepared } = canonicalFixture();
    const db = cloud();
    const plan = publicationPlan({
      publicExerciseDefinitions: [], publicExerciseTaxonomy: [], publicExerciseCatalogues: [],
    }, prepared);
    await expect(executePreparedPublication({
      session: db.session, prepared, plan, backupApproved: false,
    })).rejects.toThrow('requires confirmed private R2 backup');
    expect(db.writes).toHaveLength(0);
  });

  it('never activates if a batch fails; allows idempotent retry after partial staging', async () => {
    const { prepared } = canonicalFixture();
    const db = cloud({}, { failOnPut: 3 });
    const empty = { publicExerciseDefinitions: [], publicExerciseTaxonomy: [], publicExerciseCatalogues: [] };
    await expect(executePreparedPublication({
      session: db.session, prepared, plan: publicationPlan(empty, prepared), backupApproved: true,
    })).rejects.toThrow('Service unavailable');
    expect(db.values.publicExerciseCatalogues.size).toBe(0);
    const partial = {
      publicExerciseDefinitions: await db.session.list('publicExerciseDefinitions'),
      publicExerciseTaxonomy: [], publicExerciseCatalogues: [],
    };
    const resumed = cloud({ publicExerciseDefinitions: partial.publicExerciseDefinitions });
    const result = await executePreparedPublication({
      session: resumed.session, prepared,
      plan: publicationPlan(partial, prepared), backupApproved: true,
    });
    expect(result.status).toBe('published');
    expect(resumed.values.publicExerciseCatalogues.size).toBe(1);
  });

  it('refuses activation if a successful write is not fully readable with canonical fields', async () => {
    const { prepared } = canonicalFixture();
    const db = cloud({}, { tamperReadback: true });
    const current = { publicExerciseDefinitions: [], publicExerciseTaxonomy: [], publicExerciseCatalogues: [] };
    await expect(executePreparedPublication({
      session: db.session, prepared, plan: publicationPlan(current, prepared), backupApproved: true,
    })).rejects.toThrow('Staged publicExerciseDefinitions content mismatch');
    expect(db.values.publicExerciseCatalogues.size).toBe(0);
  });

  it('is a no-op on an already activated matching release', async () => {
    const { prepared, definitions, taxonomy, manifest } = canonicalFixture();
    const current = {
      publicExerciseDefinitions: Object.values(definitions),
      publicExerciseTaxonomy: Object.values(taxonomy),
      publicExerciseCatalogues: [{ ...manifest, publishedAt: '2026-09-01T00:00:00Z' }],
    };
    const db = cloud(current);
    const plan = publicationPlan(current, prepared);
    const result = await executePreparedPublication({
      session: db.session, prepared, plan, backupApproved: true,
    });
    expect(result.status).toBe('already-active');
    expect(db.writes).toHaveLength(0);
  });

  it('requests only scopes needed for mode and forbids writes through preview or backup session', async () => {
    const seen = [];
    const fetchFn = async (url, options) => {
      seen.push({ url, options });
      return { ok: true, status: 200, json: async () => ({ accessToken: 'redacted-test-token' }) };
    };
    const session = await openPublicSession({ dbUrl, rawKey, mode: 'preview', fetchFn });
    expect(JSON.parse(seen[0].options.body).scopes).toEqual(['ACCESS_DB', 'GLOBAL_READ']);
    await expect(session.put('publicExerciseDefinitions', [{ id: '1', realmId: REALM, owner: null }]))
      .rejects.toThrow('Unsafe publication write');
    const backup = await openPublicSession({ dbUrl, rawKey, mode: 'backup', fetchFn });
    expect(JSON.parse(seen[1].options.body).scopes)
      .toEqual(['ACCESS_DB', 'GLOBAL_READ', 'GLOBAL_WRITE']);
    await expect(backup.put('publicExerciseDefinitions', [{ id: '1', realmId: REALM, owner: null }]))
      .rejects.toThrow('Unsafe publication write');
    expect(seen).toHaveLength(2);
  });

  it('rejects active manifest for another source and rejects missing rows under an active manifest', () => {
    const { prepared, definitions, taxonomy, manifest } = canonicalFixture();
    const base = {
      publicExerciseDefinitions: Object.values(definitions),
      publicExerciseTaxonomy: Object.values(taxonomy),
    };
    expect(() => publicationPlan({
      ...base, publicExerciseCatalogues: [{ ...manifest, sourceSha256: 'another-release' }],
    }, prepared)).toThrow('Existing active catalogue differs');
    expect(() => publicationPlan({
      ...base, publicExerciseTaxonomy: [], publicExerciseCatalogues: [manifest],
    }, prepared)).toThrow('Published catalogue is missing records');
  });

  it('rejects unknown tables, token rejection, wrong realm and malformed public records', async () => {
    const requests = [];
    const tokenServer = async (url, options) => {
      requests.push({ url, options });
      return { ok: false, status: 403 };
    };
    await expect(openPublicSession({
      dbUrl, rawKey, mode: 'preview', fetchFn: tokenServer,
    })).rejects.toThrow('Dexie token failed with HTTP 403');
    expect(requests).toHaveLength(1);
    const badRowsServer = async (url) => url.endsWith('/token')
      ? { ok: true, status: 200, json: async () => ({ accessToken: 'test-token' }) }
      : { ok: true, status: 200, json: async () => [{ id: '0001', realmId: 'rlm-other' }] };
    const session = await openPublicSession({
      dbUrl, rawKey, mode: 'preview', fetchFn: badRowsServer,
    });
    await expect(session.list('privateClients')).rejects.toThrow('Forbidden public catalogue table');
    await expect(session.list('publicExerciseDefinitions')).rejects.toThrow('Invalid public rows');
  });

  it('rejects untrusted source bytes and wrong DB before any network access', async () => {
    const calls = [];
    const fetchFn = async (...args) => { calls.push(args); throw new Error('Should not call'); };
    await expect(runPublicCatalogue({
      sourceBytes: Buffer.from('not original JSON'), dbUrl, rawKey,
      mode: 'publish', backupApproved: true, fetchFn,
    })).rejects.toThrow('R2 source SHA-256 mismatch');
    await expect(openPublicSession({
      dbUrl: 'https://another.dexie.cloud', rawKey, mode: 'publish', fetchFn,
    })).rejects.toThrow('Refusing unexpected Dexie Cloud database URL');
    expect(calls).toHaveLength(0);
  });
});
