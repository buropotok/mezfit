import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MezfitCloudDatabase } from './database';
import { confirmWorkoutSync, markWorkoutChanged, observeWorkoutSyncConfirmation, workoutHasDelta } from './workout-sync';

const databases: Dexie[] = [];
afterEach(async () => { for (const db of databases.splice(0)) await db.delete(); });
async function fixture() {
  const db = new Dexie(`workout-sync-${crypto.randomUUID()}`, { addons: [] });
  databases.push(db);
  db.version(1).stores({ workoutOccurrences: 'id', localWorkoutSync: 'id' });
  await db.table('workoutOccurrences').bulkAdd([{ id: 'a' }, { id: 'b' }]);
  const sync = vi.fn(async () => {});
  const database = Object.assign(db, { cloud: { sync } }) as unknown as MezfitCloudDatabase;
  const change = (id: string) => db.transaction('rw', ['localWorkoutSync'], () => markWorkoutChanged(database, id));
  return { db: database, sync, change };
}

describe('per-workout local cloud confirmation', () => {
  it('requests native background push for local edits after native sync without a manual button', async () => {
    const { db, sync, change } = await fixture();
    const unsubscribe = vi.fn();
    // The connection may still be starting, or recovering from an earlier failure.
    Object.assign(db.cloud, { syncState: { subscribe: ({ next }: { next: (state: { phase: string }) => void }) => { next({ phase: 'in-sync' }); return { unsubscribe }; } } });
    let finish: () => void = () => {};
    sync.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
    const stop = observeWorkoutSyncConfirmation(db, vi.fn());
    try {
      await vi.waitFor(() => expect(sync).toHaveBeenCalledTimes(1));
      // A pending native upload must never prevent another local mutation.
      await change('a');
      finish();
      await vi.waitFor(async () => expect(workoutHasDelta(await db.localWorkoutSync.get('a'))).toBe(false));
      await change('a');
      await vi.waitFor(async () => expect(workoutHasDelta(await db.localWorkoutSync.get('a'))).toBe(false));
      expect(sync).toHaveBeenCalledWith({ purpose: 'push', wait: true });
    } finally { stop(); }
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it('keeps each workout independent and persists revisions across reopening', async () => {
    const { db, change } = await fixture();
    expect(workoutHasDelta(undefined)).toBe(true);
    await confirmWorkoutSync(db);
    await change('a');
    expect(workoutHasDelta(await db.localWorkoutSync.get('a'))).toBe(true);
    expect(workoutHasDelta(await db.localWorkoutSync.get('b'))).toBe(false);
    db.close();
    await db.open();
    expect(workoutHasDelta(await db.localWorkoutSync.get('a'))).toBe(true);
    expect(workoutHasDelta(await db.localWorkoutSync.get('b'))).toBe(false);
  });

  it('never confirms changes made during an in-flight upload', async () => {
    const { db, sync, change } = await fixture();
    await change('a');
    let finish!: () => void;
    sync.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
    const sending = confirmWorkoutSync(db);
    await vi.waitFor(() => expect(sync).toHaveBeenCalledTimes(1));
    await change('a');
    finish();
    await sending;
    expect(await db.localWorkoutSync.get('a')).toMatchObject({ revision: 2, confirmedRevision: 1 });
    expect(workoutHasDelta(await db.localWorkoutSync.get('a'))).toBe(true);
    await confirmWorkoutSync(db);
    expect(workoutHasDelta(await db.localWorkoutSync.get('a'))).toBe(false);
  });

  it('does not change a confirmed workout when another workout upload fails', async () => {
    const { db, sync, change } = await fixture();
    await confirmWorkoutSync(db);
    const confirmed = await db.localWorkoutSync.get('b');
    await change('a');
    sync.mockRejectedValueOnce(new Error('OFFLINE'));
    await expect(confirmWorkoutSync(db)).rejects.toThrow('OFFLINE');
    expect(workoutHasDelta(await db.localWorkoutSync.get('a'))).toBe(true);
    expect(await db.localWorkoutSync.get('b')).toEqual(confirmed);
  });

  it('rolls back the local mark with a failed domain transaction', async () => {
    const { db } = await fixture();
    await expect(db.transaction('rw', ['localWorkoutSync'], async () => {
      await markWorkoutChanged(db, 'a');
      throw new Error('INVALID_DAY');
    })).rejects.toThrow('INVALID_DAY');
    expect(await db.localWorkoutSync.get('a')).toBeUndefined();
  });

  it('does not acknowledge a stale completion after account disposal', async () => {
    const { db, change, sync } = await fixture();
    await change('a');
    let active = true;
    sync.mockImplementationOnce(async () => { active = false; });
    await confirmWorkoutSync(db, () => active);
    expect(workoutHasDelta(await db.localWorkoutSync.get('a'))).toBe(true);
  });
});
