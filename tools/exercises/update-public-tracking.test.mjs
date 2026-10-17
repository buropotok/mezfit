import { describe, expect, it } from 'vitest';
import {
  executeTrackingUpdate, trackingUpdatePlan,
} from './update-public-tracking.mjs';
import { TRACKING_RELEASE_SHA256 } from './restore-legacy-tracking.mjs';

const REALM = 'rlm-public';
const ORIGINAL_SHA = '5ce3e6b15117e115a1e10ac31573eb85eea6bf284a72971e5ca1ee02572aa40c';

function fixture() {
  const publicExerciseDefinitions = Object.fromEntries(Array.from({ length: 1324 }, (_, i) => {
    const id = String(i + 1).padStart(4, '0');
    return [id, {
      id, realmId: REALM, owner: null, sourceSha256: ORIGINAL_SHA,
      name: 'Original ' + id, image: 'images/' + id + '.jpg',
    }];
  }));
  const publicExerciseTaxonomy = Object.fromEntries(Array.from({ length: 69 }, (_, i) => {
    const id = 'tax-' + i;
    return [id, { id, realmId: REALM, owner: null, sourceSha256: ORIGINAL_SHA, kind: 'zone' }];
  }));
  const manifest = {
    id: 'mezfit:exercise-catalogue', realmId: REALM, owner: null,
    sourceSha256: ORIGINAL_SHA, schemaVersion: '2.0.0',
    publishedAt: '2026-10-01T12:00:00Z',
  };
  const prepared = {
    stage: { data: { [REALM]: { publicExerciseDefinitions, publicExerciseTaxonomy } } },
    activate: { data: { [REALM]: { publicExerciseCatalogues: { [manifest.id]: manifest } } } },
  };
  const release = { schema_version: '2.1.0', exercises: Object.keys(publicExerciseDefinitions)
    .map((id, i) => ({ id, tracking_type: i < 29 ? 'time_distance' : 'weight_reps' })) };
  const current = {
    publicExerciseDefinitions: Object.values(publicExerciseDefinitions).map(row => ({ ...row })),
    publicExerciseTaxonomy: Object.values(publicExerciseTaxonomy).map(row => ({ ...row })),
    publicExerciseCatalogues: [{ ...manifest }],
  };
  return { current, prepared, release };
}
function fakeSession(current, failAt = 0) {
  const data = Object.fromEntries(Object.entries(current)
    .map(([table, rows]) => [table, new Map(rows.map(row => [row.id, structuredClone(row)]))]));
  const writes = [];
  return {
    data, writes,
    session: {
      async list(table) { return [...data[table].values()].map(row => structuredClone(row)); },
      async put(table, rows) {
        writes.push({ table, rows: structuredClone(rows) });
        if (failAt && writes.length === failAt) throw new Error('Cloud write failed');
        rows.forEach(row => data[table].set(row.id, structuredClone(row)));
      },
    },
  };
}

describe('existing public catalogue tracking-only release', () => {
  it('prepares 1324 exact additions without changing original source rows or their IDs', () => {
    const { current, prepared, release } = fixture();
    const initial = structuredClone(current);
    const plan = trackingUpdatePlan(current, prepared, release);
    expect(plan.pending).toHaveLength(1324);
    expect(plan.alreadyActive).toBe(false);
    expect(plan.unchanged).toBe(0);
    expect(plan.pending.slice(0, 29).every(row => row.tracking_type === 'time_distance')).toBe(true);
    expect(plan.pending.slice(29).every(row => row.tracking_type === 'weight_reps')).toBe(true);
    expect(current).toEqual(initial);
    for (let i = 0; i < 1324; i++) {
      const { tracking_type: _tracking, ...base } = plan.pending[i];
      expect(base).toEqual(initial.publicExerciseDefinitions[i]);
    }
  });

  it('rejects missing/foreign rows, modified source content, changed taxonomy and existing conflicting tracking', () => {
    const mk = () => fixture();
    let f = mk();
    f.current.publicExerciseDefinitions.pop();
    expect(() => trackingUpdatePlan(f.current, f.prepared, f.release)).toThrow(/row count/);
    f = mk();
    f.current.publicExerciseDefinitions[0].id = 'foreign';
    expect(() => trackingUpdatePlan(f.current, f.prepared, f.release)).toThrow(/pinned source/);
    f = mk();
    f.current.publicExerciseDefinitions[0].name = 'Changed by user';
    expect(() => trackingUpdatePlan(f.current, f.prepared, f.release)).toThrow(/pinned source/);
    f = mk();
    f.current.publicExerciseDefinitions[0].tracking_type = 'time';
    expect(() => trackingUpdatePlan(f.current, f.prepared, f.release)).toThrow(/Conflicting existing tracking_type/);
    f = mk();
    f.current.publicExerciseTaxonomy[0].kind = 'other';
    expect(() => trackingUpdatePlan(f.current, f.prepared, f.release)).toThrow(/Public taxonomy changed/);
    f = mk();
    f.current.publicExerciseCatalogues[0].sourceSha256 = 'f'.repeat(64);
    expect(() => trackingUpdatePlan(f.current, f.prepared, f.release)).toThrow(/pinned v2.0 source/);
    f = mk();
    f.current.publicExerciseCatalogues[0].trackingSchemaVersion = 'other';
    expect(() => trackingUpdatePlan(f.current, f.prepared, f.release)).toThrow(/Conflicting public tracking release marker/);
  });

  it('refuses writes unless R2 backup and immutable candidate both exist', async () => {
    const f = fixture();
    const db = fakeSession(f.current);
    const plan = trackingUpdatePlan(f.current, f.prepared, f.release);
    await expect(executeTrackingUpdate({ session: db.session, plan, backupApproved: false, releaseStored: true }))
      .rejects.toThrow(/requires confirmed R2 backup/);
    await expect(executeTrackingUpdate({ session: db.session, plan, backupApproved: true, releaseStored: false }))
      .rejects.toThrow(/requires confirmed R2 backup/);
    expect(db.writes).toHaveLength(0);
  });

  it('updates only 1324 tracking fields, verifies readback, and activates marker last', async () => {
    const f = fixture();
    const db = fakeSession(f.current);
    const plan = trackingUpdatePlan(f.current, f.prepared, f.release);
    const result = await executeTrackingUpdate({
      session: db.session, plan, backupApproved: true, releaseStored: true,
      publishedAt: '2026-10-17T18:00:00Z',
    });
    expect(result.status).toBe('published');
    expect(result.updated).toBe(1324);
    expect(db.writes.at(-1).table).toBe('publicExerciseCatalogues');
    expect(db.writes.slice(0, -1).every(write =>
      write.table === 'publicExerciseDefinitions' && write.rows.length <= 25)).toBe(true);
    expect(db.writes.filter(write => write.table === 'publicExerciseDefinitions')
      .reduce((total, write) => total + write.rows.length, 0)).toBe(1324);
    const manifest = db.data.publicExerciseCatalogues.get('mezfit:exercise-catalogue');
    expect(manifest).toMatchObject({
      sourceSha256: ORIGINAL_SHA, schemaVersion: '2.0.0',
      trackingSchemaVersion: '2.1.0', trackingReleaseSha256: TRACKING_RELEASE_SHA256,
      publishedAt: '2026-10-17T18:00:00Z',
    });
    expect(db.data.publicExerciseDefinitions.get('0001')).toMatchObject({
      id: '0001', name: 'Original 0001', sourceSha256: ORIGINAL_SHA,
      tracking_type: 'time_distance',
    });
    expect(db.data.publicExerciseTaxonomy.size).toBe(69);
  });

  it('never activates a failed partial update and safely resumes without overwriting data', async () => {
    const f = fixture();
    const db = fakeSession(f.current, 3);
    const plan = trackingUpdatePlan(f.current, f.prepared, f.release);
    await expect(executeTrackingUpdate({
      session: db.session, plan, backupApproved: true, releaseStored: true,
    })).rejects.toThrow(/Cloud write failed/);
    expect(db.data.publicExerciseCatalogues.get('mezfit:exercise-catalogue'))
      .not.toHaveProperty('trackingReleaseSha256');
    expect(db.data.publicExerciseDefinitions.get('0001').tracking_type).toBe('time_distance');
    expect(db.data.publicExerciseDefinitions.get('1324').tracking_type).toBeUndefined();
    const resumed = {
      publicExerciseDefinitions: await db.session.list('publicExerciseDefinitions'),
      publicExerciseTaxonomy: await db.session.list('publicExerciseTaxonomy'),
      publicExerciseCatalogues: await db.session.list('publicExerciseCatalogues'),
    };
    const retryPlan = trackingUpdatePlan(resumed, f.prepared, f.release);
    expect(retryPlan.pending).toHaveLength(1274);
    const retry = fakeSession(resumed);
    const result = await executeTrackingUpdate({
      session: retry.session, plan: retryPlan, backupApproved: true, releaseStored: true,
    });
    expect(result.status).toBe('published');
    expect(retry.data.publicExerciseCatalogues.get('mezfit:exercise-catalogue')
      .trackingSchemaVersion).toBe('2.1.0');
  });

  it('refuses manifest activation if the cloud readback diverges after successful batch writes', async () => {
    const f = fixture();
    const db = fakeSession(f.current);
    const originalList = db.session.list;
    const session = {
      ...db.session,
      async list(table) {
        const rows = await originalList(table);
        if (table === 'publicExerciseDefinitions' && db.writes.length > 0) {
          rows[0] = { ...rows[0], name: 'unexpected server modification' };
        }
        return rows;
      },
    };
    await expect(executeTrackingUpdate({
      session, plan: trackingUpdatePlan(f.current, f.prepared, f.release),
      backupApproved: true, releaseStored: true,
    })).rejects.toThrow(/Tracking readback verification failed/);
    expect(db.writes.some(write => write.table === 'publicExerciseCatalogues')).toBe(false);
  });

  it('is idempotent after publication and rejects altered active records', async () => {
    const f = fixture();
    const db = fakeSession(f.current);
    await executeTrackingUpdate({ session: db.session,
      plan: trackingUpdatePlan(f.current, f.prepared, f.release),
      backupApproved: true, releaseStored: true });
    const active = {
      publicExerciseDefinitions: await db.session.list('publicExerciseDefinitions'),
      publicExerciseTaxonomy: await db.session.list('publicExerciseTaxonomy'),
      publicExerciseCatalogues: await db.session.list('publicExerciseCatalogues'),
    };
    const plan = trackingUpdatePlan(active, f.prepared, f.release);
    expect(plan.pending).toHaveLength(0);
    const writes = db.writes.length;
    const result = await executeTrackingUpdate({
      session: db.session, plan, backupApproved: true, releaseStored: true,
    });
    expect(result.status).toBe('already-active');
    expect(db.writes).toHaveLength(writes);
    active.publicExerciseDefinitions[0].tracking_type = undefined;
    expect(() => trackingUpdatePlan(active, f.prepared, f.release))
      .toThrow(/Active tracking release contains incomplete/);
  });

  it('rejects a manifest changed after planning before touching the records', async () => {
    const f = fixture();
    const db = fakeSession(f.current);
    const plan = trackingUpdatePlan(f.current, f.prepared, f.release);
    db.data.publicExerciseCatalogues.get('mezfit:exercise-catalogue').publishedAt = 'external';
    await expect(executeTrackingUpdate({
      session: db.session, plan, backupApproved: true, releaseStored: true,
    })).rejects.toThrow(/manifest changed since preview/);
    expect(db.writes).toHaveLength(0);
  });
});
