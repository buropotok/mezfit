import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { MezfitCloudDatabase } from './database';
import type { CloudWorkoutOccurrenceRow } from './workout-foundation-types';
import { WorkoutOccurrenceDraftRepository } from './workout-occurrence-drafts';
import { WorkoutSchedulingRepository } from './workout-scheduling';
import { STARTED_PLAN_MESSAGE } from './planned-session-policy';
import { relationshipMembership } from '../../../worker/lib/dexie-cloud-membership';

let db: Dexie;
const time = '2026-10-28T10:00:00.000Z';
const row = (changes: Partial<CloudWorkoutOccurrenceRow> = {}): CloudWorkoutOccurrenceRow => ({
  id: 'workout', realmId: 'tg:101', owner: 'tg:101', athleteUserId: 'tg:101', coachUserId: null,
  clientUserId: null, format: 'independent', status: 'scheduled', workoutSessionId: null,
  publicationStatus: 'published', startsAtUtc: time, durationMinutes: 60,
  plan: { name: 'Силовая', comment: null, exercises: [] }, createdByUserId: 'tg:101',
  createdAt: time, updatedAt: time, ...changes,
});
const drafts = () => new WorkoutOccurrenceDraftRepository(db as MezfitCloudDatabase, 'tg:101');
const calendar = () => new WorkoutSchedulingRepository(db as MezfitCloudDatabase, 'tg:101');
beforeEach(() => {
  db = new Dexie('cancellation-' + crypto.randomUUID());
  db.version(1).stores({ workoutOccurrences: 'id, realmId', localWorkoutSync: 'id', realms: 'realmId', members: 'id, realmId' });
  db.table('workoutOccurrences').hook('deleting', () => { throw new Error('Physical deletion is forbidden'); });
});
afterEach(async () => { await db.delete(); });

describe('workout cancellation and logical deletion', () => {
  it('cancellation preserves the record and PLAN, removes occupancy and remains readable in the basket projection', async () => {
    const original = row(); await db.table('workoutOccurrences').put(original);
    await drafts().cancel(original.id);
    expect((await calendar().listCalendar())).toEqual([]);
    expect((await calendar().listWorkspace(true)).map(item => item.id)).toEqual([original.id]);
    expect(await db.table('workoutOccurrences').get(original.id)).toMatchObject({
      status: 'scheduled', cancelledAt: expect.any(String), plan: original.plan,
    });
    await drafts().cancel(original.id); // Deterministic repeated intent.
    expect(await db.table('workoutOccurrences').count()).toBe(1);
  });
  it.each([null, time])('deactivation hides active/cancelled bookings everywhere while retaining their data (%s)', async cancelledAt => {
    const original = row({ cancelledAt }); await db.table('workoutOccurrences').put(original);
    await drafts().deactivate(original.id);
    await drafts().deactivate(original.id);
    expect(await calendar().listWorkspace(true)).toEqual([]);
    expect(await calendar().listCalendar()).toEqual([]);
    expect(await drafts().get('draft:' + original.id)).toBeNull();
    expect(await db.table('workoutOccurrences').get(original.id)).toMatchObject({ inactive: true, cancelledAt, plan: original.plan });
  });
  it('lets the coach remove old cancelled test drafts without changing source records', async () => {
    const pair = await relationshipMembership('101', '202');
    await db.table('realms').put(pair.realm); await db.table('members').bulkPut(pair.members);
    const original = row({ realmId: pair.realm.realmId, owner: pair.realm.realmId,
      coachUserId: 'tg:101', clientUserId: 'tg:202', athleteUserId: 'tg:202', format: 'coached',
      publicationStatus: 'draft', cancelledAt: time });
    await db.table('workoutOccurrences').put(original);
    expect((await calendar().listWorkspace(true)).map(item => item.id)).toEqual([original.id]);
    await drafts().deactivate(original.id);
    expect(await calendar().listWorkspace(true)).toEqual([]);
    expect((await db.table('workoutOccurrences').get(original.id)).plan).toEqual(original.plan);
  });
  it.each(['in_progress', 'completed'] as const)('protects a %s session even when deletion was confirmed from a stale editor', async status => {
    await db.table('workoutOccurrences').put(row({ status, workoutSessionId: 'execution' }));
    await expect(drafts().deactivate('workout')).rejects.toThrow(STARTED_PLAN_MESSAGE);
    expect((await db.table('workoutOccurrences').get('workout')).inactive).toBeUndefined();
  });
  it('rejects another account and never changes its occurrence', async () => {
    await db.table('workoutOccurrences').put(row({ realmId: 'tg:999', owner: 'tg:999', athleteUserId: 'tg:999' }));
    await expect(drafts().deactivate('workout')).rejects.toThrow('SCHEDULE_FORBIDDEN');
    expect((await db.table('workoutOccurrences').get('workout')).inactive).toBeUndefined();
  });
  it('newly discarded unpublished drafts use inactive rather than cancellation', async () => {
    await db.table('workoutOccurrences').put(row({ publicationStatus: 'draft' }));
    await drafts().delete('draft:workout');
    expect(await calendar().listWorkspace(true)).toEqual([]);
    expect(await db.table('workoutOccurrences').get('workout')).toMatchObject({ inactive: true });
    expect((await db.table('workoutOccurrences').get('workout')).cancelledAt).toBeUndefined();
  });
});
