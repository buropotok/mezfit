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

/** Occurrence v2 always contains its own PLAN; legacy plan-less fixtures are deprecated. */
const occurrencePlan = { name: 'День', comment: null, exercises: [] };
async function seedOccurrences(db: Dexie, rows: Record<string, unknown>[]): Promise<void> {
  await db.table('workoutOccurrences').bulkPut(rows.map(row => ({ plan: occurrencePlan, ...row })));
}
async function seedOccurrence(db: Dexie, row: Record<string, unknown>): Promise<void> {
  await db.table('workoutOccurrences').put({ plan: occurrencePlan, ...row });
}

describe('confirmed workout calendar projections', () => {
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

  it('keeps booked workouts after their original day is deprecated and isolates clients', async () => {
    const f = await fixture();
    const booking = { realmId: f.pair.realm.realmId, owner: null,
      coachUserId: 'tg:101', clientUserId: 'tg:202', athleteUserId: 'tg:202',
      programDayId: 'assigned-day', workoutSessionId: null,
      startsAtUtc: '2026-10-19T08:00:00.000Z',
      durationMinutes: 60, status: 'scheduled' };
    await seedOccurrences(f.db, [
      { ...booking, id: 'client-alone', format: 'independent' },
      { ...booking, id: 'with-coach', format: 'coached',
        startsAtUtc: '2026-10-19T10:00:00.000Z' },
    ]);
    await f.db.table('programDays').update('assigned-day', { status: 'deprecated' });
    expect((await f.client.listCalendar()).map(row => row.id))
      .toEqual(['client-alone', 'with-coach']);
    expect((await f.coach.listCalendar()).map(row => row.id)).toEqual(['with-coach']);
    expect(await f.stranger.listCalendar()).toEqual([]);
  });

  it('uses the authorized client calendar after source deletion when suggesting slots', async () => {
    const f = await fixture();
    await seedOccurrence(f.db, {
      id: 'booked-before-deletion', realmId: f.pair.realm.realmId, owner: null,
      coachUserId: 'tg:101', clientUserId: 'tg:202', athleteUserId: 'tg:202',
      programDayId: 'assigned-day', workoutSessionId: null, format: 'independent',
      startsAtUtc: '2026-10-19T08:00:00.000Z', durationMinutes: 60, status: 'scheduled',
    });
    await f.db.table('trainingPlans').delete('assigned');
    await f.db.table('programPhases').delete('assigned-phase');
    expect((await f.coach.listCalendar('tg:202')).map(row => row.id))
      .toEqual(['booked-before-deletion']);
    expect(await f.coach.listCalendar()).toEqual([]);
    expect(await f.stranger.listCalendar('tg:202')).toEqual([]);
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
