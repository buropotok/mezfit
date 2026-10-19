// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import dexieCloud from 'dexie-cloud-addon';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ProgramPhaseDays } from '../../program/ProgramPhaseDays';
import { SchedulePlanningContext } from '../../schedule/SchedulePlanningContext';
import type { CloudProgramDayOutline } from './workout-foundation-types';
import type { ProgramManagementRepository } from './program-management';
import type { CloudTrainingPlanRow } from './database';
import { relationshipMembership } from '../../../worker/lib/dexie-cloud-membership';
import { WorkoutOccurrenceDraftRepository } from './workout-occurrence-drafts';
import { WorkoutSchedulingRepository } from './workout-scheduling';
import type { MezfitCloudDatabase } from './database';

vi.mock('./CloudConnectionsProvider', () => ({ useCloudConnections: () => ({ db: state.db, clients: [], coaches: [] }) }));
vi.mock('../../program/usePhaseDayMotion', () => ({ usePhaseDayMotion: () => {} }));
vi.mock('../../program/ProgramDayExercisePicker', () => ({ ProgramDayExercisePicker: () => null }));
vi.mock('../../program/ProgramDayDialog', () => ({ ProgramDayDialog: () => null }));
vi.mock('../../program/PlanActionDialog', () => ({ PlanActionDialog: () => null }));
vi.mock('../../ui', () => ({ Text: ({ children }: { children: string }) => children, Avatar: () => null }));
vi.mock('../../workout/WorkoutSessionCard', () => ({ WorkoutSessionCard: ({ onSchedule }: { onSchedule: (format: 'coached' | 'independent') => void }) =>
  createElement('button', { onClick: () => onSchedule(state.format) }, 'Запланировать') }));
const state = vi.hoisted(() => ({ db: null as MezfitCloudDatabase | null, format: 'coached' as 'coached' | 'independent' }));
const databases: Dexie[] = [];
afterEach(async () => {
  cleanup();
  for (const db of databases.splice(0)) await db.delete();
  vi.unstubAllGlobals();
});

describe('pinned Addon shared occurrence ownership', () => {
  it.each(['coached', 'independent'] as const)('plans and saves %s client workouts with the real Addon after existing bookings', async format => {
    state.format = format;
    const db = new Dexie('shared-addon-' + crypto.randomUUID(), { addons: [dexieCloud] });
    databases.push(db);
    db.version(1).stores({ workoutOccurrences: '@id, realmId', localWorkoutOccurrenceDrafts: 'id', localWorkoutSync: 'id' });
    db.cloud.configure({ databaseUrl: '', requireAuth: false, disableEagerSync: true, disableWebSocket: true,
      tryUseServiceWorker: false, unsyncedTables: ['localWorkoutOccurrenceDrafts', 'localWorkoutSync'] });
    const pair = await relationshipMembership('101', '202');
    const other = await relationshipMembership('101', '303');
    await db.open();
    // Seed the server's ownerless membership without local implicit-property rewriting.
    await new Promise<void>((resolve, reject) => {
      const tx = db.backendDB().transaction(['realms', 'members'], 'readwrite');
      tx.objectStore('realms').put(pair.realm);
      tx.objectStore('realms').put(other.realm);
      for (const member of [...pair.members, ...other.members]) tx.objectStore('members').put(member);
      tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error);
    });
    const repository = new WorkoutOccurrenceDraftRepository(db as MezfitCloudDatabase, 'tg:101');
    const plan = { name: 'День', comment: null, exercises: [] };
    const draft = { id: 'draft:shared', actorUserId: 'tg:101', realmId: pair.realm.realmId,
      trainingPlanId: 'program', programDayId: 'day', athleteUserId: 'tg:202', coachUserId: 'tg:101', clientUserId: 'tg:202',
      format, startsAtUtc: '2026-10-19T08:00:00.000Z', durationMinutes: 60,
      plan, originalPlan: plan, createdAt: '2026-10-19T00:00:00.000Z', updatedAt: '2026-10-19T00:00:00.000Z' };
    draft.id = await repository.create(draft);
    const pendingId = draft.id.slice(6);
    expect(await db.table('workoutOccurrences').get(pendingId)).toMatchObject({ publicationStatus: 'draft' });
    expect(db.cloud.schema?.workoutOccurrences.markedForSync).toBe(true);
    expect(await new WorkoutSchedulingRepository(db as MezfitCloudDatabase, 'tg:202').listWorkspace()).toEqual([]);
    const id = await repository.save(draft.id);
    const calendar = new WorkoutSchedulingRepository(db as MezfitCloudDatabase, 'tg:101');
    expect((await calendar.listWorkspace()).map(row => row.id)).toContain(id);
    expect((await new WorkoutSchedulingRepository(db as MezfitCloudDatabase, 'tg:202').listWorkspace()).map(row => row.id)).toContain(id);
    expect((await calendar.listCalendar()).some(row => row.id === id)).toBe(format === 'coached');
    // Existing bookings in two relationship realms exercise repeated WebCrypto checks.
    const second = { ...draft, id: 'draft:other', realmId: other.realm.realmId, athleteUserId: 'tg:303', clientUserId: 'tg:303', startsAtUtc: '2026-10-19T12:00:00.000Z' };
    second.id = await repository.create(second); await repository.save(second.id);
    await repository.enqueueEdit('draft:' + id, current => ({ ...current, startsAtUtc: '2026-10-19T07:45:00.000Z', durationMinutes: 75 }));
    expect(await repository.get('draft:' + id)).toMatchObject({ saved: true, durationMinutes: 75 });
    await repository.replacePlan('draft:' + id, { ...plan, name: 'Правка' });
    await repository.save('draft:' + id);
    state.db = db as MezfitCloudDatabase;
    const openDraft = vi.fn();
    const program: CloudTrainingPlanRow = { id: 'program', realmId: pair.realm.realmId, owner: null, athleteUserId: 'tg:202',
      coachUserId: 'tg:101', clientUserId: 'tg:202', name: 'Программа', position: 0, status: 'active',
      startedAt: null, finishedAt: null, createdAt: draft.createdAt, updatedAt: draft.updatedAt };
    const day: CloudProgramDayOutline = { day: { id: 'day', realmId: pair.realm.realmId, owner: null, programPhaseId: 'phase',
      name: 'День', comment: null, status: 'active', position: 0 }, exercises: [] };
    render(createElement(SchedulePlanningContext.Provider, { value: { requestedDraftId: null, clearDraft: () => {}, openDraft } },
      createElement(ProgramPhaseDays, { repository: { actorUserId: 'tg:101' } as ProgramManagementRepository,
        program, days: [day], phaseStatus: 'active', readOnly: false })));
    fireEvent.click(screen.getByRole('button', { name: 'Запланировать' }));
    await waitFor(() => expect(openDraft).toHaveBeenCalledTimes(1));
    const [created] = await repository.list();
    await repository.save(created.id);
    expect(await repository.list()).toEqual([]);
  });

  it('preserves a realm owner without making either participant the object owner', async () => {
    const fetch = vi.fn(() => Promise.reject(new Error('Network must not be used')));
    vi.stubGlobal('fetch', fetch);
    const db = new Dexie('occurrence-addon-' + crypto.randomUUID(), { addons: [dexieCloud] });
    databases.push(db);
    db.version(1).stores({ workoutOccurrences: '@id, realmId' });
    // A local-only Addon instance exercises its actual middleware without authentication/network.
    db.cloud.configure({ databaseUrl: '', requireAuth: false, disableEagerSync: true, disableWebSocket: true, tryUseServiceWorker: false });
    const table = db.table('workoutOccurrences');
    const realmId = 'rlm' + 'a'.repeat(28);
    const missingOwnerId = await table.add({ realmId, owner: null });
    const implicit = await table.get(missingOwnerId);
    expect(implicit.owner).not.toBeNull(); // 4.4.15 replaces falsy ownership.
    const sharedId = await table.add({ realmId, owner: realmId });
    const shared = await table.get(sharedId);
    expect(shared.owner).toBe(realmId);
    expect(shared.owner).not.toBe('tg:101');
    expect(shared.owner).not.toBe('tg:202');
    expect(shared.owner).not.toBe(db.cloud.currentUserId);
    expect(fetch).not.toHaveBeenCalled();
  });
});
