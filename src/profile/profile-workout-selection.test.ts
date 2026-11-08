import { describe, expect, it } from 'vitest';
import type { CalendarWorkoutSession } from '../data/cloud/adhoc-workouts';
import type { CloudWorkoutOccurrenceRow } from '../data/cloud/workout-foundation-types';
import { selectProfileWorkoutRows } from './profile-workout-selection';

const today = '2026-11-08' as const;
const client = { userId: 'tg:202', relationshipId: 'relationship-1' };

function occurrence(id: string, date: string, options: Partial<CloudWorkoutOccurrenceRow> = {}): CloudWorkoutOccurrenceRow {
  return {
    id, realmId: client.relationshipId, owner: client.relationshipId,
    athleteUserId: client.userId, clientUserId: client.userId, coachUserId: 'tg:101',
    workoutSessionId: null, format: 'coached', startsAtUtc: date,
    durationMinutes: 60, status: 'scheduled', publicationStatus: 'published',
    plan: { name: id, category: null, comment: null, exercises: [] },
    ...options,
  };
}

function session(id: string, date: string, options: Partial<CalendarWorkoutSession> = {}): CalendarWorkoutSession {
  return {
    id, realmId: client.relationshipId, owner: client.relationshipId,
    athleteUserId: client.userId, clientUserId: client.userId, coachUserId: 'tg:101',
    creatorUserId: 'tg:101', name: id, comment: null, programName: null,
    autoCreatedProgram: false, status: 'completed', format: 'coached',
    startedAt: date, completedAt: date, createdAt: date, updatedAt: date,
    ...options,
  };
}

const occurrences = [
  occurrence('missed', '2026-11-07T13:30:00'),
  occurrence('today', '2026-11-08T13:30:00'),
  occurrence('future', '2026-11-10T13:30:00'),
  occurrence('cancelled', '2026-11-07T13:30:00', { status: 'cancelled' }),
  occurrence('hidden-draft', '2026-11-10T13:30:00', { publicationStatus: 'draft' }),
  occurrence('inactive', '2026-11-07T13:30:00', { inactive: true }),
  occurrence('other-client', '2026-11-07T13:30:00', { athleteUserId: 'tg:303' }),
  occurrence('other-realm', '2026-11-07T13:30:00', { realmId: 'relationship-2' }),
];
const sessions = [
  session('completed', '2026-11-06T10:00:00'),
  session('active', '2026-11-08T12:00:00', { status: 'active', completedAt: null }),
  session('another-client', '2026-11-06T10:00:00', { athleteUserId: 'tg:303' }),
  session('another-realm', '2026-11-06T10:00:00', { realmId: 'relationship-2' }),
];

describe('profile workout PLAN / FACT projection', () => {
  it('shows only today and future published scheduled occurrences on Plan', () => {
    const rows = selectProfileWorkoutRows({
      occurrences, sessions, contact: client, actorUserId: 'tg:101', mode: 'plan', today,
    });
    expect(rows.map(row => row.kind === 'completed' ? row.session.id : row.occurrence.id))
      .toEqual(['today', 'future']);
  });

  it('shows completed FACT and only past missed PLAN on History, newest first', () => {
    const rows = selectProfileWorkoutRows({
      occurrences, sessions, contact: client, actorUserId: 'tg:101', mode: 'history', today,
    });
    expect(rows.map(row => [row.kind, row.kind === 'completed' ? row.session.id : row.occurrence.id]))
      .toEqual([['missed', 'missed'], ['completed', 'completed']]);
  });

  it('uses inclusive From / To filters on History, not the Plan list', () => {
    const history = selectProfileWorkoutRows({
      occurrences, sessions, contact: client, actorUserId: 'tg:101', mode: 'history', today,
      from: '2026-11-07', to: '2026-11-07',
    });
    expect(history.map(row => row.kind)).toEqual(['missed']);
    const plan = selectProfileWorkoutRows({
      occurrences, sessions, contact: client, actorUserId: 'tg:101', mode: 'plan', today,
      from: '2026-11-07', to: '2026-11-07',
    });
    expect(plan).toHaveLength(2);
  });

  it('selects only the signed-in athlete when no relationship scope is supplied', () => {
    const rows = selectProfileWorkoutRows({
      occurrences, sessions, actorUserId: client.userId, mode: 'history', today,
    });
    expect(rows.map(row => row.kind)).toEqual(['missed', 'missed', 'completed', 'completed']);
  });
});
