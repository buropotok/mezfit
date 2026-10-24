import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, expect, it } from 'vitest';
import type { MezfitCloudDatabase } from './database';
import { PersonalEventRepository } from './personal-events';

const opened: Dexie[] = [];
afterEach(async () => {
  for (const db of opened.splice(0)) await db.delete();
});

it('tracks create, edit, move and cancellation for ordinary Dexie Cloud sync confirmation', async () => {
  const db = new Dexie('personal-event-sync-' + crypto.randomUUID());
  db.version(1).stores({
    workoutOccurrences: 'id, realmId, startsAtUtc',
    localWorkoutSync: 'id',
    realms: 'realmId', members: 'id, realmId',
  });
  db.table('workoutOccurrences').hook('creating', (key, row) => {
    if (key) return undefined;
    row.id = 'occ' + crypto.randomUUID().replaceAll('-', '');
    return row.id;
  });
  opened.push(db);
  const events = new PersonalEventRepository(db as unknown as MezfitCloudDatabase, 'tg:101');
  const input = {
    title: 'Личное событие', notes: null,
    startsAtUtc: '2026-10-28T08:00:00.000Z', durationMinutes: 60,
  };
  const id = await events.create(input);
  const syncRow = () => db.table('localWorkoutSync').get(id);
  expect(await syncRow()).toMatchObject({
    revision: 1, confirmedRevision: 0, confirmed: false,
  });
  await events.update(id, { ...input, notes: 'Изменение' });
  expect(await syncRow()).toMatchObject({ revision: 2, confirmedRevision: 0 });
  const time = { startsAtUtc: '2026-10-28T11:00:00.000Z', durationMinutes: 45 };
  await events.move(id, time);
  expect(await syncRow()).toMatchObject({ revision: 3, confirmedRevision: 0 });
  await events.move(id, time);
  expect(await syncRow()).toMatchObject({ revision: 3, confirmedRevision: 0 });
  await events.cancel(id);
  expect(await syncRow()).toMatchObject({ revision: 4, confirmedRevision: 0 });
  expect(await db.table('workoutOccurrences').get(id)).toMatchObject({ cancelledAt: expect.any(String) });
});
