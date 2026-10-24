import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';
import { relationshipMembership } from '../../../worker/lib/dexie-cloud-membership';
import type { MezfitCloudDatabase } from './database';
import { PersonalEventRepository } from './personal-events';
import { WorkoutSchedulingRepository } from './workout-scheduling';
import { WorkoutOccurrenceDraftRepository } from './workout-occurrence-drafts';
import { assertLocalWorkoutSlot } from './workout-slot-validation';

const opened: Dexie[] = [];
afterEach(async () => { for (const db of opened.splice(0)) await db.delete(); });

async function fixture() {
  const db = new Dexie('personal-events-' + crypto.randomUUID());
  db.version(1).stores({
    workoutOccurrences: 'id, realmId, startsAtUtc', realms: 'realmId',
    members: 'id, realmId', localWorkoutSync: 'id',
  });
  db.table('workoutOccurrences').hook('creating', (key, row) => {
    if (!key) { row.id = 'occ' + crypto.randomUUID().replaceAll('-', ''); return row.id; }
  });
  opened.push(db);
  const pair = await relationshipMembership('101', '202');
  await db.table('realms').put(pair.realm);
  await db.table('members').bulkPut(pair.members);
  const typed = db as unknown as MezfitCloudDatabase;
  return { db, pair, coach: new PersonalEventRepository(typed, 'tg:101'),
    client: new PersonalEventRepository(typed, 'tg:202'),
    coachSchedule: new WorkoutSchedulingRepository(typed, 'tg:101'),
    clientSchedule: new WorkoutSchedulingRepository(typed, 'tg:202'),
    outsiderSchedule: new WorkoutSchedulingRepository(typed, 'tg:303'),
    drafts: new WorkoutOccurrenceDraftRepository(typed, 'tg:101'), typed };
}

const input = { title: 'Личные дела', notes: 'Банк', startsAtUtc: '2026-10-28T08:00:00.000Z',
  durationMinutes: 60 };

describe('personal calendar events', () => {
  it('creates a personal synced occurrence without a program, session or workout draft', async () => {
    const f = await fixture();
    const id = await f.coach.create(input);
    expect(await f.db.table('workoutOccurrences').get(id)).toMatchObject({
      entryKind: 'personal_event', realmId: 'tg:101', owner: 'tg:101',
      athleteUserId: 'tg:101', coachUserId: null, clientUserId: null,
      format: 'independent', status: 'scheduled', workoutSessionId: null,
      publicationStatus: 'published', plan: { name: 'Личные дела', comment: 'Банк', exercises: [] },
    });
    expect((await f.coachSchedule.listCalendar()).map(row => row.id)).toEqual([id]);
    expect((await f.coachSchedule.listWorkspace()).map(row => row.id)).toEqual([id]);
    expect(await f.clientSchedule.listCalendar()).toEqual([]);
    expect(await f.outsiderSchedule.listWorkspace()).toEqual([]);
    expect(await f.drafts.get('draft:' + id)).toBeNull();
    expect(await f.drafts.list()).toEqual([]);
  });

  it('uses the shared validator for both event and coached workout conflicts', async () => {
    const f = await fixture();
    const id = await f.coach.create(input);
    await expect(f.coach.create({ ...input, title: 'Накладка' })).rejects.toThrow(/время занято/);
    await expect(assertLocalWorkoutSlot(f.typed, {
      actorUserId: 'tg:101', athleteUserId: 'tg:202', coachUserId: 'tg:101',
      format: 'coached', startsAtUtc: '2026-10-28T08:30:00.000Z', durationMinutes: 45,
    })).rejects.toThrow(/время занято/);
    await expect(f.client.create(input)).resolves.toEqual(expect.any(String));
    await f.coach.cancel(id);
    await expect(f.coach.create(input)).resolves.toEqual(expect.any(String));
  });

  it('blocks personal event creation on an existing coached workout but not independent client time', async () => {
    const f = await fixture();
    const workout = { id: 'client-workout', realmId: f.pair.realm.realmId, owner: f.pair.realm.realmId,
      athleteUserId: 'tg:202', clientUserId: 'tg:202', coachUserId: 'tg:101', format: 'coached',
      startsAtUtc: input.startsAtUtc, durationMinutes: 60, workoutSessionId: null, status: 'scheduled',
      plan: { name: 'Силовая', comment: null, exercises: [] } };
    await f.db.table('workoutOccurrences').add(workout);
    await expect(f.coach.create(input)).rejects.toThrow(/время занято/);
    await f.db.table('workoutOccurrences').update(workout.id, { format: 'independent' });
    await expect(f.coach.create(input)).resolves.toEqual(expect.any(String));
  });

  it('edits, moves and cancels only its own personal event without changing any workout', async () => {
    const f = await fixture();
    const id = await f.coach.create(input);
    await f.coach.update(id, { title: '  Встреча  ', notes: 'Описание', startsAtUtc: input.startsAtUtc, durationMinutes: 90 });
    await f.coach.move(id, { startsAtUtc: '2026-10-28T10:00:00.000Z', durationMinutes: 45 });
    expect(await f.db.table('workoutOccurrences').get(id)).toMatchObject({
      publicationStatus: 'published', startsAtUtc: '2026-10-28T10:00:00.000Z',
      durationMinutes: 45, plan: { name: 'Встреча', comment: 'Описание' },
    });
    await expect(f.client.update(id, input)).rejects.toThrow('PERSONAL_EVENT_NOT_FOUND');
    await expect(f.coach.update(id, { ...input, title: ' ' })).rejects.toThrow(/Название события/);
    await f.coach.cancel(id);
    expect(await f.coachSchedule.listCalendar()).toEqual([]);
    await expect(f.coach.move(id, input)).rejects.toThrow('PERSONAL_EVENT_NOT_FOUND');
  });

  it('rejects malformed event identities and keeps regular workouts out of event operations', async () => {
    const f = await fixture();
    const id = await f.coach.create(input);
    await f.db.table('workoutOccurrences').update(id, { clientUserId: 'tg:202' });
    expect(await f.coachSchedule.listCalendar()).toEqual([]);
    await expect(f.coach.update(id, input)).rejects.toThrow('PERSONAL_EVENT_NOT_FOUND');
    await f.db.table('workoutOccurrences').put({ id: 'ordinary', realmId: 'tg:101', owner: 'tg:101',
      athleteUserId: 'tg:101', coachUserId: null, clientUserId: null, format: 'independent',
      startsAtUtc: input.startsAtUtc, durationMinutes: 60, status: 'scheduled', workoutSessionId: null,
      plan: { name: 'Тренировка', comment: null, exercises: [] } });
    await expect(f.coach.cancel('ordinary')).rejects.toThrow('PERSONAL_EVENT_NOT_FOUND');
  });
});
