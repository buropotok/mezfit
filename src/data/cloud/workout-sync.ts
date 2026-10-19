import { liveQuery } from 'dexie';
import type { LocalProgramSyncRow, MezfitCloudDatabase } from './database';

/** Local presentation metadata only. Never replicated or used to replay writes. */
export async function markWorkoutChanged(db: MezfitCloudDatabase, id: string): Promise<void> {
  const row = await db.localWorkoutSync.get(id);
  await db.localWorkoutSync.put({ id, revision: (row?.revision ?? 0) + 1,
    confirmedRevision: row?.confirmedRevision ?? 0, confirmed: row?.confirmed ?? false });
}

export function workoutHasDelta(row: LocalProgramSyncRow | undefined): boolean {
  return !row?.confirmed || row.revision > row.confirmedRevision;
}

/** Capture before the public push barrier, then confirm only that captured version.
 * Addon 4.4.15's awaited push resolves when its pending mutation queue is empty.
 * Edits committed during the wait retain a higher revision and remain pending.
 */
export async function confirmWorkoutSync(db: MezfitCloudDatabase, isActive = () => true): Promise<void> {
  const snapshot = await db.transaction('rw', ['workoutOccurrences', 'localWorkoutSync'], async () => {
    const occurrences = await db.workoutOccurrences.toArray();
    const result: LocalProgramSyncRow[] = [];
    for (const occurrence of occurrences) {
      let row = await db.localWorkoutSync.get(occurrence.id);
      if (!row) {
        row = { id: occurrence.id, revision: 0, confirmedRevision: 0, confirmed: false };
        await db.localWorkoutSync.add(row);
      }
      if (workoutHasDelta(row)) result.push(row);
    }
    return result;
  });
  if (!snapshot.length || !isActive()) return;
  await db.cloud.sync({ purpose: 'push', wait: true });
  if (!isActive()) return;
  await db.transaction('rw', ['localWorkoutSync'], async () => {
    for (const sent of snapshot) {
      const current = await db.localWorkoutSync.get(sent.id);
      if (!current) continue;
      await db.localWorkoutSync.update(sent.id, {
        confirmed: true, confirmedRevision: Math.max(current.confirmedRevision, sent.revision),
      });
    }
  });
}

/** Observe native synchronization to confirm local revisions, independent of
 * publication status. Native Addon eager sync owns uploading. No custom retries,
 * transport, timers, or private Addon mutation tables. Addon owns all replication.
 */
export function observeWorkoutSyncConfirmation(db: MezfitCloudDatabase,
  onError: (reason: unknown) => void): () => void {
  let active = true, ready = false, running = false, changed = false;
  const check = async () => {
    changed = true;
    if (!active || !ready || running) return;
    running = true;
    try {
      do {
        changed = false;
        await confirmWorkoutSync(db, () => active);
      } while (active && ready && changed);
    } catch (reason) {
      if (active) onError(reason);
    } finally { running = false; }
  };
  const state = db.cloud.syncState.subscribe({ next: value => {
    ready = value.phase === 'in-sync';
    if (ready) void check();
  }, error: reason => { if (active) onError(reason); } });
  const changes = liveQuery(async () => ({
    occurrences: (await db.workoutOccurrences.toArray()).map(row => row.id),
    pending: (await db.localWorkoutSync.toArray()).filter(workoutHasDelta)
      .map(row => `${row.id}:${row.revision}`),
  })).subscribe({ next: () => { void check(); }, error: reason => { if (active) onError(reason); } });
  return () => { active = false; state.unsubscribe(); changes.unsubscribe(); };
}
