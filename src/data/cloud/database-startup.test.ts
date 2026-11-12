// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { afterEach, expect, it } from 'vitest';
import { MezfitCloudDatabase } from './database';

const databases: MezfitCloudDatabase[] = [];
afterEach(async () => {
  for (const db of databases.splice(0)) await db.delete();
});

it('opens the local database without importing retired device-only drafts', async () => {
  const telegramUserId = '9987654387';
  const actorUserId = 'tg:' + telegramUserId;
  const db = new MezfitCloudDatabase(telegramUserId, '', { discussions: true });
  databases.push(db);
  db.cloud.configure({
    databaseUrl: '', requireAuth: false, disableEagerSync: true,
    disableWebSocket: true, tryUseServiceWorker: false,
    unsyncedTables: ['localProgramSync', 'localWorkoutOccurrenceDrafts', 'localWorkoutSync'],
  });
  await db.open();

  const plan = { name: 'Старый черновик', comment: null, exercises: [] };
  const draft = {
    id: 'draft:retired', actorUserId, realmId: actorUserId, athleteUserId: actorUserId,
    coachUserId: null, clientUserId: null, format: 'independent' as const,
    startsAtUtc: '2026-11-13T12:00:00.000Z', durationMinutes: 60,
    plan, originalPlan: plan, createdAt: '2026-11-12T12:00:00.000Z',
    updatedAt: '2026-11-12T12:00:00.000Z',
  };
  await db.localWorkoutOccurrenceDrafts.add(draft);
  db.close();

  await db.open();
  expect(await db.localWorkoutOccurrenceDrafts.get(draft.id)).toEqual(draft);
  expect(await db.workoutOccurrences.count()).toBe(0);
});
