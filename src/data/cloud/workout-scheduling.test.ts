import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';
import { relationshipMembership } from '../../../worker/lib/dexie-cloud-membership';
import type { CloudTrainingPlanRow, MezfitCloudDatabase } from './database';
import type { CloudProgramDayRow, CloudProgramPhaseRow } from './workout-foundation-types';
import { WorkoutSchedulingRepository, scheduleRequestId } from './workout-scheduling';

const dbs: Dexie[] = [];
afterEach(async () => { for (const db of dbs.splice(0)) await db.delete(); });

async function fixture() {
  const db = new Dexie('schedule-foundation-' + crypto.randomUUID());
  dbs.push(db);
  db.version(1).stores({
    trainingPlans: 'id, realmId',
    programPhases: 'id, trainingPlanId',
    programDays: 'id, realmId, programPhaseId',
    workoutScheduleRequests: 'id, realmId, requestKey, startsAtUtc, trainingPlanId, programDayId',
    workoutOccurrences: 'id, realmId, startsAtUtc',
    realms: 'realmId',
    members: 'id, realmId',
  });
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
  format: 'independent' as const, startsAtUtc: '2026-10-19T08:00:00.000Z',
  durationMinutes: 60,
});


/** Occurrence v2 always contains its own PLAN; legacy plan-less fixtures are deprecated. */
const occurrencePlan = { name: 'День', comment: null, exercises: [] };
async function seedOccurrences(db: Dexie, rows: Record<string, unknown>[]): Promise<void> {
  await db.table('workoutOccurrences').bulkPut(rows.map(row => ({ plan: occurrencePlan, ...row })));
}
async function seedOccurrence(db: Dexie, row: Record<string, unknown>): Promise<void> {
  await db.table('workoutOccurrences').put({ plan: occurrencePlan, ...row });
}

describe('local-first workout scheduling intent', () => {
  it('accepts independent personal schedules for both roles and separate occurrences of one day', async () => {
    const f = await fixture();
    const coachId = await f.coach.createRequest(command('coach-personal', 'client-action-0001'));
    const clientId = await f.client.createRequest(command('client-personal', 'client-action-0002'));
    const againId = await f.client.createRequest(command('client-personal', 'client-action-0003'));
    expect(coachId).not.toBe(clientId);
    expect(coachId).toBe(scheduleRequestId('tg:101', 'client-action-0001'));
    expect(clientId).toBe(scheduleRequestId('tg:202', 'client-action-0002'));
    expect(againId).not.toBe(clientId);
    expect(await f.client.listRequests('client-personal')).toHaveLength(2);
    expect(await f.coach.listRequests('coach-personal')).toHaveLength(1);
    expect(await f.db.table('workoutOccurrences').count()).toBe(0);
    expect((await f.db.table('workoutScheduleRequests').get(clientId))).toMatchObject({
      realmId: 'tg:202', owner: null, requestedByUserId: 'tg:202', coachUserId: null,
      athleteUserId: 'tg:202', action: 'create', targetOccurrenceId: null,
    });
  });

  it('permits the same retry key from different actors without a sync-unique secondary index', async () => {
    const f = await fixture();
    const key = 'shared-retry-key-01';
    const coachId = await f.coach.createRequest(command('assigned', key));
    const clientId = await f.client.createRequest(command('assigned', key));
    expect(coachId).toBe(scheduleRequestId('tg:101', key));
    expect(clientId).toBe(scheduleRequestId('tg:202', key));
    expect(coachId).not.toBe(clientId);
    expect(await f.db.table('workoutScheduleRequests').count()).toBe(2);
    expect((await f.client.listRequests('assigned')).map(row => row.id))
      .toEqual([coachId, clientId]);
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

  it('stores a client-requested coached workout as an unconfirmed intent', async () => {
    const f = await fixture();
    const id = await f.client.createRequest({
      ...command('assigned', 'client-coached-0001'), format: 'coached',
    });
    const record = await f.db.table('workoutScheduleRequests').get(id);
    expect(record).toMatchObject({
      action: 'create', format: 'coached', requestedByUserId: 'tg:202',
      coachUserId: 'tg:101', athleteUserId: 'tg:202',
    });
    expect(record).not.toHaveProperty('status');
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
    await expect(f.client.createRequest({ ...input, startsAtUtc: '2026-10-19T10:30:00.000Z' }))
      .rejects.toThrow('SCHEDULE_REQUEST_KEY_CONFLICT');
    await expect(f.client.createRequest({ ...input, requestKey: '?' }))
      .rejects.toThrow('INVALID_SCHEDULE_REQUEST');
    await expect(f.client.createRequest({ ...input, requestKey: 'client-action-0021',
      startsAtUtc: '2026-02-30T08:00:00.000Z' })).rejects.toThrow('INVALID_SCHEDULE_START_UTC');
    await expect(f.client.createRequest({ ...input, requestKey: 'client-action-0022',
      format: 'coached' })).rejects.toThrow('SCHEDULE_COACH_REQUIRED');
    expect(await f.db.table('workoutScheduleRequests').count()).toBe(1);
  });

  it('does not project unsupported or malformed synchronized scheduling intents', async () => {
    const f = await fixture();
    const id = await f.client.createRequest(command('client-personal', 'valid-request-101'));
    const valid = await f.db.table('workoutScheduleRequests').get(id);
    expect(valid).toBeDefined();
    const invalidChanges = [
      { action: 'cancel' },
      { action: 'reschedule' },
      { targetOccurrenceId: 'occ-someone-else' },
      { format: 'coached' },
      { startsAtUtc: '2026-10-19T10:00:00.000+02:00' },
      { createdAt: 'yesterday' },
      { durationMinutes: 0 },
      { owner: 'tg:303' },
      { athleteUserId: 'tg:303' },
    ];
    for (const [index, patch] of invalidChanges.entries()) {
      const key = 'invalid-request-' + index;
      await f.db.table('workoutScheduleRequests').put({
        ...valid, id: scheduleRequestId('tg:202', key),
        requestKey: key, ...patch,
      });
    }
    expect((await f.client.listRequests('client-personal')).map(row => row.id))
      .toEqual([id]);
  });

  it('captures one immutable UTC request snapshot before asynchronous PLAN lookups', async () => {
    const f = await fixture();
    const input = command('client-personal', 'snapshot-request-01');
    const promise = f.client.createRequest(input);
    input.startsAtUtc = '2026-10-19T16:00:00.000Z';
    input.durationMinutes = 120;
    const id = await promise;
    const saved = await f.db.table('workoutScheduleRequests').get(id);
    expect(saved).toMatchObject({
      startsAtUtc: '2026-10-19T08:00:00.000Z', durationMinutes: 60,
    });
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

  it('rejects old plan-less and malformed PLAN occurrences', async () => {
    const f = await fixture();
    const base = { id: 'no-plan', realmId: f.pair.realm.realmId, owner: null,
      coachUserId: 'tg:101', clientUserId: 'tg:202', athleteUserId: 'tg:202',
      programDayId: 'assigned-day', workoutSessionId: null,
      format: 'coached', startsAtUtc: '2026-10-19T08:00:00.000Z',
      durationMinutes: 60, status: 'scheduled' };
    await seedOccurrences(f.db, [
      { ...base, id: 'valid-new-plan' },
      { ...base, id: 'no-plan', plan: undefined },
      { ...base, id: 'malformed-plan', plan: { name: 'Invalid', comment: null,
        exercises: [{ id: 'broken', position: 0 }] } },
    ]);
    expect((await f.client.listCalendar()).map(row => row.id)).toEqual(['valid-new-plan']);
  });

  it('excludes cancelled occurrences from active program and calendar projections', async () => {
    const f = await fixture();
    const rows = [
      { id: 'occ-active', realmId: f.pair.realm.realmId, owner: null,
        coachUserId: 'tg:101', clientUserId: 'tg:202', athleteUserId: 'tg:202',
        programDayId: 'assigned-day', workoutSessionId: null, format: 'coached',
        startsAtUtc: '2026-10-19T08:00:00.000Z', durationMinutes: 60,
        status: 'scheduled' },
      { id: 'occ-cancelled', realmId: f.pair.realm.realmId, owner: null,
        coachUserId: 'tg:101', clientUserId: 'tg:202', athleteUserId: 'tg:202',
        programDayId: 'assigned-day', workoutSessionId: null, format: 'coached',
        startsAtUtc: '2026-10-19T10:00:00.000Z', durationMinutes: 60,
        status: 'cancelled' },
    ];
    await seedOccurrences(f.db, rows);
    for (const view of ['program', 'calendar'] as const) {
      expect((await f.client.listOccurrences('assigned', view)).map(row => row.id))
        .toEqual(['occ-active']);
      expect(await f.coach.getOccurrence('assigned', 'occ-cancelled', view)).toBeNull();
    }
  });

  it('shows client independent workouts in their PLAN but never books the coach calendar', async () => {
    const f = await fixture();
    const occurrence = (id: string, format: 'coached' | 'independent',
      createdByUserId: string) => ({
      id, realmId: f.pair.realm.realmId, owner: null,
      coachUserId: 'tg:101', clientUserId: 'tg:202', athleteUserId: 'tg:202',
      programDayId: 'assigned-day', workoutSessionId: null,
      format, createdByUserId, startsAtUtc: '2026-10-19T08:00:00.000Z',
      durationMinutes: 60, status: 'scheduled' as const,
    });
    await seedOccurrences(f.db, [
      occurrence('client-independent', 'independent', 'tg:202'),
      occurrence('coach-planned-independent', 'independent', 'tg:101'),
      occurrence('coach-guided', 'coached', 'tg:101'),
      occurrence('client-request-approved', 'coached', 'tg:202'),
    ]);
    expect((await f.coach.listOccurrences('assigned', 'program')).map(row => row.id))
      .toEqual(['client-independent', 'client-request-approved', 'coach-guided', 'coach-planned-independent']);
    expect((await f.coach.listOccurrences('assigned', 'calendar')).map(row => row.id))
      .toEqual(['client-request-approved', 'coach-guided']);
    expect((await f.client.listOccurrences('assigned', 'calendar')).map(row => row.id))
      .toHaveLength(4);
    expect(await f.coach.getOccurrence('assigned', 'client-independent', 'calendar'))
      .toBeNull();
    expect((await f.coach.getOccurrence('assigned', 'client-independent', 'program'))?.id)
      .toBe('client-independent');
    await expect(f.coach.listOccurrences('assigned', 'invalid' as 'calendar'))
      .rejects.toThrow('INVALID_SCHEDULE_VIEW');
  });

  it('keeps a coach personal independent workout on their own calendar', async () => {
    const f = await fixture();
    await seedOccurrence(f.db, {
      id: 'coach-own-training', realmId: 'tg:101', owner: null,
      coachUserId: null, clientUserId: null, athleteUserId: 'tg:101',
      programDayId: 'coach-personal-day', workoutSessionId: null,
      format: 'independent', createdByUserId: 'tg:101',
      startsAtUtc: '2026-10-19T08:00:00.000Z', durationMinutes: 60,
      status: 'scheduled',
    });
    expect((await f.coach.listOccurrences('coach-personal', 'calendar')).map(row => row.id))
      .toEqual(['coach-own-training']);
  });

  it('rejects invalid synchronized occurrence formats and noncanonical UTC instants', async () => {
    const f = await fixture();
    const expected = {
      realmId: f.pair.realm.realmId, owner: null,
      coachUserId: 'tg:101', clientUserId: 'tg:202', athleteUserId: 'tg:202',
      programDayId: 'assigned-day', workoutSessionId: null,
      format: 'coached', startsAtUtc: '2026-10-19T08:00:00.000Z',
      durationMinutes: 60,
      status: 'scheduled',
    };
    const records = [
      { ...expected, id: 'occ-valid' },
      { ...expected, id: 'occ-invalid-format', format: 'unexpected' },
      { ...expected, id: 'occ-no-format', format: undefined },
      { ...expected, id: 'occ-no-start', startsAtUtc: undefined },
      { ...expected, id: 'occ-offset-start', startsAtUtc: '2026-10-19T10:00:00.000+02:00' },
      { ...expected, id: 'occ-invalid-start', startsAtUtc: '2026-02-30T08:00:00.000Z' },
    ];
    await seedOccurrences(f.db, records);
    for (const view of ['program', 'calendar'] as const) {
      for (const repository of [f.coach, f.client]) {
        expect((await repository.listOccurrences('assigned', view)).map(row => row.id))
          .toEqual(['occ-valid']);
        for (const record of records.slice(1)) {
          expect(await repository.getOccurrence('assigned', record.id, view)).toBeNull();
        }
      }
    }
  });

  it('rejects coached personal workouts without a coach while keeping independent ones', async () => {
    const f = await fixture();
    const valid = {
      realmId: 'tg:202', owner: null, coachUserId: null, clientUserId: null,
      athleteUserId: 'tg:202', programDayId: 'client-personal-day',
      workoutSessionId: null, format: 'independent',
      startsAtUtc: '2026-10-19T08:00:00.000Z', durationMinutes: 60,
      status: 'scheduled',
    };
    await seedOccurrences(f.db, [
      { ...valid, id: 'personal-independent' },
      { ...valid, id: 'personal-coached', format: 'coached' },
    ]);
    for (const view of ['calendar', 'program'] as const) {
      expect((await f.client.listOccurrences('client-personal', view)).map(row => row.id))
        .toEqual(['personal-independent']);
      expect(await f.client.getOccurrence('client-personal', 'personal-coached', view))
        .toBeNull();
    }
  });

  it('requires a materialized session ID for started/completed occurrences', async () => {
    const f = await fixture();
    const valid = {
      realmId: f.pair.realm.realmId, owner: null,
      coachUserId: 'tg:101', clientUserId: 'tg:202', athleteUserId: 'tg:202',
      programDayId: 'assigned-day', format: 'coached',
      workoutSessionId: null, startsAtUtc: '2026-10-19T08:00:00.000Z',
      durationMinutes: 60, status: 'scheduled',
    };
    await seedOccurrences(f.db, [
      { ...valid, id: 'scheduled' },
      { ...valid, id: 'invalid-running', status: 'in_progress' },
      { ...valid, id: 'invalid-completed', status: 'completed' },
      { ...valid, id: 'invalid-session-empty', status: 'completed', workoutSessionId: '' },
      { ...valid, id: 'invalid-scheduled-session', status: 'scheduled', workoutSessionId: 'ses-1' },
      { ...valid, id: 'running', status: 'in_progress', workoutSessionId: 'ses-1' },
      { ...valid, id: 'completed', status: 'completed', workoutSessionId: 'ses-2' },
    ]);
    const expectedIds = ['completed', 'running', 'scheduled'];
    for (const view of ['calendar', 'program'] as const) {
      expect((await f.client.listOccurrences('assigned', view)).map(row => row.id))
        .toEqual(expectedIds);
      expect((await f.coach.listOccurrences('assigned', view)).map(row => row.id))
        .toEqual(expectedIds);
    }
  });

  it('rejects malformed optional occurrence provenance and timestamps', async () => {
    const f = await fixture();
    const valid = {
      realmId: f.pair.realm.realmId, owner: null,
      coachUserId: 'tg:101', clientUserId: 'tg:202', athleteUserId: 'tg:202',
      programDayId: 'assigned-day', workoutSessionId: null,
      format: 'coached', startsAtUtc: '2026-10-19T08:00:00.000Z',
      durationMinutes: 60, status: 'scheduled',
      createdByUserId: 'tg:101',
      sourceRequestId: 'req:tg:101:coach-request-123',
      createdAt: '2026-10-18T12:00:00.000Z',
      updatedAt: '2026-10-18T12:00:00.000Z',
    };
    const rejected = [
      { createdByUserId: 42 },
      { createdByUserId: 'invalid-user' },
      { sourceRequestId: {} },
      { sourceRequestId: '' },
      { createdAt: false },
      { createdAt: '2026-10-18T12:00:00+00:00' },
      { updatedAt: null },
      { athleteUserId: 42 },
      { athleteUserId: undefined },
      { coachUserId: '' },
      { clientUserId: '' },
      { workoutSessionId: 123 },
      { durationMinutes: -1 },
    ];
    await seedOccurrences(f.db, [
      { ...valid, id: 'valid-provenance' },
      ...rejected.map((patch, i) => ({ ...valid, id: 'invalid-provenance-' + i, ...patch })),
    ]);
    for (const view of ['program', 'calendar'] as const) {
      expect((await f.client.listOccurrences('assigned', view)).map(row => row.id))
        .toEqual(['valid-provenance']);
    }
  });

  it('orders distinct UTC instants through the DST overlap without a saved timezone', async () => {
    const f = await fixture();
    const common = {
      realmId: f.pair.realm.realmId, owner: null,
      coachUserId: 'tg:101', clientUserId: 'tg:202', athleteUserId: 'tg:202',
      programDayId: 'assigned-day', workoutSessionId: null, format: 'coached',
      durationMinutes: 60, status: 'scheduled',
    };
    const first = '2026-10-25T00:30:00.000Z';
    const second = '2026-10-25T01:30:00.000Z';
    await seedOccurrences(f.db, [
      { ...common, id: 'second', startsAtUtc: second },
      { ...common, id: 'first', startsAtUtc: first },
    ]);
    expect((await f.client.listOccurrences('assigned', 'calendar')).map(row => row.id))
      .toEqual(['first', 'second']);
  });

  it('keeps occurrences read-only and filters them by the authorized PLAN', async () => {
    const f = await fixture();
    await seedOccurrences(f.db, [
      { id: 'occ-good', realmId: f.pair.realm.realmId, owner: null,
        coachUserId: 'tg:101', clientUserId: 'tg:202', athleteUserId: 'tg:202',
        programDayId: 'assigned-day', workoutSessionId: null, format: 'independent',
        startsAtUtc: '2026-10-19T08:00:00.000Z', durationMinutes: 60,
        status: 'scheduled' },
      { id: 'occ-foreign', realmId: f.pair.realm.realmId, owner: null,
        coachUserId: 'tg:101', clientUserId: 'tg:202', athleteUserId: 'tg:202',
        programDayId: 'other-day', workoutSessionId: null, format: 'independent',
        startsAtUtc: '2026-10-19T08:00:00.000Z', durationMinutes: 60,
        status: 'scheduled' },
      { id: 'occ-wrong-client', realmId: f.pair.realm.realmId, owner: null,
        coachUserId: 'tg:101', clientUserId: 'tg:303', athleteUserId: 'tg:202',
        programDayId: 'assigned-day', workoutSessionId: null, format: 'independent',
        startsAtUtc: '2026-10-19T08:00:00.000Z', durationMinutes: 60,
        status: 'scheduled' },
      { id: 'occ-missing-client', realmId: f.pair.realm.realmId, owner: null,
        coachUserId: 'tg:101', clientUserId: null, athleteUserId: 'tg:202',
        programDayId: 'assigned-day', workoutSessionId: null, format: 'independent',
        startsAtUtc: '2026-10-19T08:00:00.000Z', durationMinutes: 60,
        status: 'scheduled' },
    ]);
    expect((await f.client.listOccurrences('assigned', 'program')).map(row => row.id)).toEqual(['occ-good']);
    expect((await f.client.getOccurrence('assigned', 'occ-good', 'program'))?.id).toBe('occ-good');
    expect(await f.client.getOccurrence('assigned', 'occ-foreign', 'program')).toBeNull();
  });
});
