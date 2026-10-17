import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MezfitCloudDatabase } from './database';
import { confirmProgramSync, markProgramChanged, programHasDelta } from './program-sync';

const databases: Dexie[] = [];
afterEach(async () => { for (const db of databases.splice(0)) await db.delete(); });
async function fixture() {
  const db = new Dexie(`program-sync-${crypto.randomUUID()}`, { addons: [] });
  databases.push(db);
  db.version(1).stores({ trainingPlans: 'id', localProgramSync: 'id' });
  await db.table('trainingPlans').bulkAdd([{ id: 'a' }, { id: 'b' }]);
  const sync = vi.fn(async () => {});
  const database = Object.assign(db, { cloud: { sync } }) as unknown as MezfitCloudDatabase;
  const change = (id: string) => db.transaction('rw', ['localProgramSync'], () => markProgramChanged(database, id));
  return { db: database, sync, change };
}

describe('per-program local cloud confirmation', () => {
  it('keeps each program independent and persists revisions across reopening', async () => {
    const { db, change } = await fixture();
    expect(programHasDelta(undefined)).toBe(true);
    await confirmProgramSync(db);
    await change('a');
    expect(programHasDelta(await db.localProgramSync.get('a'))).toBe(true);
    expect(programHasDelta(await db.localProgramSync.get('b'))).toBe(false);
    db.close();
    await db.open();
    expect(programHasDelta(await db.localProgramSync.get('a'))).toBe(true);
    expect(programHasDelta(await db.localProgramSync.get('b'))).toBe(false);
  });

  it('never confirms changes made during an in-flight upload', async () => {
    const { db, sync, change } = await fixture();
    await change('a');
    let finish!: () => void;
    sync.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
    const sending = confirmProgramSync(db);
    await vi.waitFor(() => expect(sync).toHaveBeenCalledTimes(1));
    await change('a');
    finish();
    await sending;
    expect(await db.localProgramSync.get('a')).toMatchObject({ revision: 2, confirmedRevision: 1 });
    expect(programHasDelta(await db.localProgramSync.get('a'))).toBe(true);
    await confirmProgramSync(db);
    expect(programHasDelta(await db.localProgramSync.get('a'))).toBe(false);
  });

  it('does not change a confirmed program when another program upload fails', async () => {
    const { db, sync, change } = await fixture();
    await confirmProgramSync(db);
    const confirmed = await db.localProgramSync.get('b');
    await change('a');
    sync.mockRejectedValueOnce(new Error('OFFLINE'));
    await expect(confirmProgramSync(db)).rejects.toThrow('OFFLINE');
    expect(programHasDelta(await db.localProgramSync.get('a'))).toBe(true);
    expect(await db.localProgramSync.get('b')).toEqual(confirmed);
  });

  it('rolls back the local mark with a failed domain transaction', async () => {
    const { db } = await fixture();
    await expect(db.transaction('rw', ['localProgramSync'], async () => {
      await markProgramChanged(db, 'a');
      throw new Error('INVALID_DAY');
    })).rejects.toThrow('INVALID_DAY');
    expect(await db.localProgramSync.get('a')).toBeUndefined();
  });

  it('does not acknowledge a stale completion after account disposal', async () => {
    const { db, change, sync } = await fixture();
    await change('a');
    let active = true;
    sync.mockImplementationOnce(async () => { active = false; });
    await confirmProgramSync(db, () => active);
    expect(programHasDelta(await db.localProgramSync.get('a'))).toBe(true);
  });
});
