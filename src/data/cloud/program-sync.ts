import { liveQuery } from 'dexie';
import type { LocalProgramSyncRow, MezfitCloudDatabase } from './database';

/** Local presentation metadata only. Never replicated or used to replay writes. */
export async function markProgramChanged(db: MezfitCloudDatabase, id: string): Promise<void> {
  const row = await db.localProgramSync.get(id);
  await db.localProgramSync.put({ id, revision: (row?.revision ?? 0) + 1,
    confirmedRevision: row?.confirmedRevision ?? 0, confirmed: row?.confirmed ?? false });
}

export function programHasDelta(row: LocalProgramSyncRow | undefined): boolean {
  return !row?.confirmed || row.revision > row.confirmedRevision;
}

/** Capture before the public push barrier, then confirm only that captured version.
 * Addon 4.4.15's awaited push resolves when its pending mutation queue is empty.
 * Edits committed during the wait retain a higher revision and remain pending.
 */
export async function confirmProgramSync(db: MezfitCloudDatabase, isActive = () => true): Promise<void> {
  const snapshot = await db.transaction('rw', ['trainingPlans', 'localProgramSync'], async () => {
    const plans = await db.trainingPlans.toArray();
    const result: LocalProgramSyncRow[] = [];
    for (const plan of plans) {
      let row = await db.localProgramSync.get(plan.id);
      if (!row) {
        row = { id: plan.id, revision: 0, confirmedRevision: 0, confirmed: false };
        await db.localProgramSync.add(row);
      }
      if (programHasDelta(row)) result.push(row);
    }
    return result;
  });
  if (!snapshot.length || !isActive()) return;
  await db.cloud.sync({ purpose: 'push', wait: true });
  if (!isActive()) return;
  await db.transaction('rw', ['localProgramSync'], async () => {
    for (const sent of snapshot) {
      const current = await db.localProgramSync.get(sent.id);
      if (!current) continue;
      await db.localProgramSync.update(sent.id, {
        confirmed: true, confirmedRevision: Math.max(current.confirmedRevision, sent.revision),
      });
    }
  });
}

/** Observe successful global synchronization and local deltas. No custom retries,
 * transport, timers, or private Addon mutation tables. Addon owns all replication.
 */
export function observeProgramSyncConfirmation(db: MezfitCloudDatabase,
  onError: (reason: unknown) => void): () => void {
  let active = true, ready = false, running = false, changed = false;
  const check = async () => {
    changed = true;
    if (!active || !ready || running) return;
    running = true;
    try {
      do {
        changed = false;
        await confirmProgramSync(db, () => active);
      } while (active && ready && changed);
    } catch (reason) {
      ready = false;
      if (active) onError(reason);
    } finally { running = false; }
  };
  const state = db.cloud.syncState.subscribe({ next: value => {
    ready = value.phase === 'in-sync';
    if (ready) void check();
  }, error: reason => { if (active) onError(reason); } });
  const changes = liveQuery(async () => ({
    plans: (await db.trainingPlans.toArray()).map(row => row.id),
    pending: (await db.localProgramSync.toArray()).filter(programHasDelta)
      .map(row => `${row.id}:${row.revision}`),
  })).subscribe({ next: () => { void check(); }, error: reason => { if (active) onError(reason); } });
  return () => { active = false; state.unsubscribe(); changes.unsubscribe(); };
}
