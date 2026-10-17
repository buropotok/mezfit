import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';
import { relationshipMembership } from '../../../worker/lib/dexie-cloud-membership';
import type { CloudTrainingPlanRow, MezfitCloudDatabase } from './database';
import type { CloudProgramDayRow, CloudProgramPhaseRow } from './workout-foundation-types';
import { WorkoutSchedulingRepository } from './workout-scheduling';

const dbs: Dexie[] = [];
afterEach(async () => { for (const db of dbs.splice(0)) await db.delete(); });

async function fixture() {
  const db = new Dexie('schedule-foundation-' + crypto.randomUUID());
  dbs.push(db);
  db.version(1).stores({
    trainingPlans: 'id, realmId',
    programPhases: 'id, trainingPlanId',
    programDays: 'id, realmId, programPhaseId',
    workoutScheduleRequests: 'id, realmId, &requestKey, trainingPlanId, programDayId',
    workoutOccurrences: 'id, realmId',
    realms: 'realmId',
    members: 'id, realmId',
  });
  let counter = 0;
  db.table('workoutScheduleRequests').hook('creating',
    key => key === undefined ? 'req-' + (++counter) : undefined);
  const pair = await relationshipMembership('101', '202');
  await db.table('realms').put(pair.realm);
  await db.table('members').bulkAdd(pair.members);
  const now = '2026-10-18T00:00:00.000Z';
  const program = (id: string, realmId: string, athlete: string,
    coach: string | null, client: string | null): CloudTrainingPlanRow => ({
    id, realmId, owner: null, athleteUserId: athlete, coachUserId: coach,
    clientUserId: client, name: 'Программа', status: 'active', position: 0,
    startedAt: null, finishedAt: null, createdAt: now, updatedAt: now,
  });
  const plans = [
    program('assigned', pair.realm.realmId, 'tg:202', 'tg:101', 'tg:202'),
    program('coach-personal', 'tg:101', 'tg:101', null, null),
    program('client-personal', 'tg:202', 'tg:202', null, null),
  ];
  const phases: CloudProgramPhaseRow[] = plans.map(row => ({
    id: row.id + '-phase', realmId: row.realmId, owner: null, trainingPlanId: row.id,
    name: 'Фаза', position: 0, status: 'pending', durationWeeks: 4,
    plannedStartDate: null, plannedEndDate: null,
  }));
  const days: CloudProgramDayRow[] = plans.map(row => ({
    id: row.id + '-day', realmId: row.realmId, owner: null,
    programPhaseId: row.id + '-phase', name: 'День', position: 0, status: 'active',
    comment: null, category: null,
  }));
  await db.table('trainingPlans').bulkPut(plans);
  await db.table('programPhases').bulkPut(phases);
  await db.table('programDays').bulkPut(days);
  const typed = db as unknown as MezfitCloudDatabase;
  return { db, pair, coach: new WorkoutSchedulingRepository(typed, 'tg:101'),
    client: new WorkoutSchedulingRepository(typed, 'tg:202'),
    stranger: new WorkoutSchedulingRepository(typed, 'tg:303') };
}

const command = (trainingPlanId: string, requestKey: string) => ({
  trainingPlanId, programDayId: trainingPlanId + '-day', requestKey,
  format: 'independent' as const, calendarDate: '2026-10-19',
  startMinute: 600, durationMinutes: 60, timeZone: 'Europe/Berlin',
});

describe('local-first workout scheduling intent', () => {
  it('accepts independent personal schedules for both roles and separate occurrences of one day', async () => {
    const f = await fixture();
    const coachId = await f.coach.createRequest(command('coach-personal', 'client-action-0001'));
    const clientId = await f.client.createRequest(command('client-personal', 'client-action-0002'));
    const againId = await f.client.createRequest(command('client-personal', 'client-action-0003'));
    expect(coachId).not.toBe(clientId);
    expect(againId).not.toBe(clientId);
    expect(await f.client.listRequests('client-personal')).toHaveLength(2);
    expect(await f.coach.listRequests('coach-personal')).toHaveLength(1);
    expect(await f.db.table('workoutOccurrences').count()).toBe(0);
    expect((await f.db.table('workoutScheduleRequests').get(clientId))).toMatchObject({
      realmId: 'tg:202', owner: null, requestedByUserId: 'tg:202', coachUserId: null,
      athleteUserId: 'tg:202', action: 'create', targetOccurrenceId: null,
    });
  });

  it('allows a coach or a client to request assigned workouts without granting PLAN writes', async () => {
    const f = await fixture();
    const first = await f.coach.createRequest({ ...command('assigned', 'action-coach-0001'),
      format: 'coached' });
    const second = await f.client.createRequest(command('assigned', 'action-client-0001'));
    const rows = await f.client.listRequests('assigned');
    expect(rows.map(row => row.id)).toEqual([first, second]);
    expect(rows.map(row => row.requestedByUserId)).toEqual(['tg:101', 'tg:202']);
    expect(rows.every(row => row.owner === null && row.realmId === f.pair.realm.realmId)).toBe(true);
    expect(await f.db.table('workoutOccurrences').count()).toBe(0);
  });

  it('denies foreign realms, client draft PLAN and unpublished phases', async () => {
    const f = await fixture();
    await expect(f.stranger.createRequest(command('assigned', 'foreign-action-01')))
      .rejects.toThrow('SCHEDULE_FORBIDDEN');
    await expect(f.coach.createRequest(command('client-personal', 'foreign-action-02')))
      .rejects.toThrow('SCHEDULE_FORBIDDEN');
    await f.db.table('trainingPlans').update('assigned', { status: 'draft' });
    await expect(f.client.createRequest(command('assigned', 'client-action-0001')))
      .rejects.toThrow('SCHEDULE_PLAN_NOT_PUBLISHED');
    await f.db.table('trainingPlans').update('assigned', { status: 'active' });
    await f.db.table('programPhases').update('assigned-phase', { status: 'draft' });
    await expect(f.client.createRequest(command('assigned', 'client-action-0002')))
      .rejects.toThrow('SCHEDULE_DAY_NOT_PUBLISHED');
    await f.db.table('programPhases').update('assigned-phase', { status: 'pending' });
    await f.db.table('programDays').update('assigned-day', { realmId: 'tg:303' });
    await expect(f.client.createRequest(command('assigned', 'client-action-0003')))
      .rejects.toThrow('SCHEDULE_DAY_NOT_FOUND');
    expect(await f.db.table('workoutScheduleRequests').count()).toBe(0);
  });

  it('rejects changed membership and deleted/invalid day', async () => {
    const f = await fixture();
    await f.db.table('members').delete(f.pair.members[1].id);
    await expect(f.coach.createRequest(command('assigned', 'action-coach-0010')))
      .rejects.toThrow('SCHEDULE_FORBIDDEN');
    await f.db.table('programDays').update('coach-personal-day', { status: 'deprecated' });
    await expect(f.coach.createRequest(command('coach-personal', 'action-coach-0011')))
      .rejects.toThrow('SCHEDULE_DAY_NOT_FOUND');
    expect(await f.db.table('workoutScheduleRequests').count()).toBe(0);
  });

  it('retries the same command idempotently, rejecting changed payload and invalid input', async () => {
    const f = await fixture(), input = command('client-personal', 'client-action-0020');
    const first = await f.client.createRequest(input);
    expect(await f.client.createRequest(input)).toBe(first);
    expect(await f.db.table('workoutScheduleRequests').count()).toBe(1);
    await expect(f.client.createRequest({ ...input, startMinute: 750 }))
      .rejects.toThrow('SCHEDULE_REQUEST_KEY_CONFLICT');
    await expect(f.client.createRequest({ ...input, requestKey: '?' }))
      .rejects.toThrow('INVALID_SCHEDULE_REQUEST');
    await expect(f.client.createRequest({ ...input, requestKey: 'client-action-0021',
      calendarDate: '2026-02-30' })).rejects.toThrow('INVALID_SCHEDULE_DATE');
    await expect(f.client.createRequest({ ...input, requestKey: 'client-action-0022',
      format: 'coached' })).rejects.toThrow('SCHEDULE_COACH_REQUIRED');
    expect(await f.db.table('workoutScheduleRequests').count()).toBe(1);
  });

  it('remains idempotent if Dexie Cloud implicitly assigns the request creator as owner', async () => {
    const f = await fixture(), input = command('client-personal', 'client-action-0023');
    const id = await f.client.createRequest(input);
    await f.db.table('workoutScheduleRequests').update(id, { owner: 'tg:202' });
    expect(await f.client.createRequest(input)).toBe(id);
    expect((await f.client.listRequests('client-personal')).map(row => row.id)).toEqual([id]);
  });

  it('commits one local record without cloud sync and rolls back on failure', async () => {
    const f = await fixture();
    const table = f.db.table('workoutScheduleRequests');
    table.hook('creating', () => { throw new Error('DEVICE_STORAGE_FULL'); });
    await expect(f.coach.createRequest(command('assigned', 'action-coach-0020')))
      .rejects.toThrow('DEVICE_STORAGE_FULL');
    expect(await table.count()).toBe(0);
  });

  it('emits the local commit through liveQuery and retains it on repository recreation', async () => {
    const f = await fixture();
    let unsubscribe: (() => void) | undefined;
    const received = new Promise<string[]>((resolve, reject) => {
      const subscription = f.client.observeRequests('client-personal', rows => {
        if (rows.length) { unsubscribe?.(); resolve(rows.map(row => row.id)); }
      }, reject);
      unsubscribe = () => subscription.unsubscribe();
    });
    const id = await f.client.createRequest(command('client-personal', 'client-action-0030'));
    expect(await received).toEqual([id]);
    const repo = new WorkoutSchedulingRepository(f.db as unknown as MezfitCloudDatabase, 'tg:202');
    expect((await repo.listRequests('client-personal')).map(row => row.id)).toEqual([id]);
  });

  it('keeps occurrences read-only and filters them by the authorized PLAN', async () => {
    const f = await fixture();
    await f.db.table('workoutOccurrences').bulkPut([
      { id: 'occ-good', realmId: f.pair.realm.realmId, owner: null,
        coachUserId: 'tg:101', clientUserId: 'tg:202', athleteUserId: 'tg:202',
        programDayId: 'assigned-day', workoutSessionId: null,
        calendarDate: '2026-10-19', startMinute: 600, durationMinutes: 60,
        status: 'scheduled' },
      { id: 'occ-foreign', realmId: f.pair.realm.realmId, owner: null,
        coachUserId: 'tg:101', clientUserId: 'tg:202', athleteUserId: 'tg:202',
        programDayId: 'other-day', workoutSessionId: null,
        calendarDate: '2026-10-19', startMinute: 600, durationMinutes: 60,
        status: 'scheduled' },
    ]);
    expect((await f.client.listOccurrences('assigned')).map(row => row.id)).toEqual(['occ-good']);
    expect((await f.client.getOccurrence('assigned', 'occ-good'))?.id).toBe('occ-good');
    expect(await f.client.getOccurrence('assigned', 'occ-foreign')).toBeNull();
  });
});
