import { expect, it } from 'vitest';
import { PLANNED_SESSION_LOCAL_START_APPROVED } from './planned-session-release';
import { AdHocWorkoutRepository } from './adhoc-workouts';
import type { MezfitCloudDatabase } from './database';
it('keeps the proposed scheduled exception disabled without touching storage', async () => {
  expect(PLANNED_SESSION_LOCAL_START_APPROVED).toBe(false);
  // Constructor makes no storage calls. Any accidental attempt to transact fails this test.
  const db = { transaction: () => { throw new Error('Unexpected write before approval'); } } as unknown as MezfitCloudDatabase;
  await expect(new AdHocWorkoutRepository(db, 'tg:101').createFromOccurrence('occurrence'))
    .rejects.toThrow('PLANNED_START_NOT_APPROVED');
});
