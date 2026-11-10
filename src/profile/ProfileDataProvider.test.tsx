// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { webcrypto } from 'node:crypto';
import Dexie from 'dexie';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { relationshipMembership } from '../../worker/lib/dexie-cloud-membership';
import type { CloudContact } from '../data/cloud/CloudConnectionsProvider';
import { AdHocWorkoutRepository } from '../data/cloud/adhoc-workouts';
import type { AdHocSessionRow } from '../data/cloud/adhoc-workout-types';
import type { MezfitCloudDatabase } from '../data/cloud/database';
import { WorkoutOccurrenceDraftRepository } from '../data/cloud/workout-occurrence-drafts';
import type { CloudWorkoutOccurrenceRow } from '../data/cloud/workout-foundation-types';
import { ProfileDataProvider, useProfileSnapshot } from './ProfileDataProvider';
import type { ProfileTab } from './ProfileWorkspace';
import { selectProfileWorkoutRows } from './profile-workout-selection';

let cloud: { db: MezfitCloudDatabase; actorUserId: string; coaches: CloudContact[] } | null;
vi.mock('../data/cloud/CloudConnectionsProvider', () => ({ useCloudConnections: () => cloud }));

const databases: Dexie[] = [];
afterEach(async () => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  cloud = null;
  for (const db of databases.splice(0)) await db.delete();
});

const past = '2026-11-07T12:00:00.000Z';
const future = '2026-11-09T12:00:00.000Z';
const plan = (name: string) => ({ name, category: null, comment: null, exercises: [] });
const contact = (id: string, relationshipId: string): CloudContact => ({
  userId: 'tg:' + id, telegramUserId: id, relationshipId, displayName: id,
});

function booking(id: string, startsAtUtc: string, client?: CloudContact): CloudWorkoutOccurrenceRow {
  const athleteUserId = client?.userId ?? cloud?.actorUserId ?? 'tg:101';
  const realmId = client?.relationshipId ?? athleteUserId;
  return { id, startsAtUtc, realmId, owner: realmId, athleteUserId,
    coachUserId: client ? 'tg:101' : null, clientUserId: client?.userId ?? null,
    status: 'scheduled', workoutSessionId: null, publicationStatus: 'published',
    format: client ? 'coached' : 'independent', durationMinutes: 60, plan: plan(id) };
}

function completed(id: string, athleteUserId = 'tg:101'): AdHocSessionRow {
  return { id, name: id, athleteUserId, realmId: athleteUserId, owner: athleteUserId,
    coachUserId: null, clientUserId: null, creatorUserId: athleteUserId, status: 'completed',
    startedAt: past, completedAt: past, createdAt: past, updatedAt: past, comment: null,
    programName: null, autoCreatedProgram: false };
}

async function fixture() {
  vi.stubGlobal('crypto', webcrypto);
  const db = new Dexie('profile-data-' + crypto.randomUUID(), { addons: [] }) as MezfitCloudDatabase;
  databases.push(db);
  db.version(1).stores({
    realms: 'realmId', members: 'id, realmId, userId',
    workoutOccurrences: 'id, realmId',
    adHocSessions: 'id, realmId, athleteUserId',
    adHocExercises: 'id, realmId, sessionId',
    adHocSets: 'id, realmId, sessionId, exerciseId',
    publicExerciseDefinitions: 'id, realmId',
  });
  await db.open();
  cloud = { db, actorUserId: 'tg:101', coaches: [] };
  return db;
}

function Rows({ tab, client }: { tab: ProfileTab; client?: CloudContact }) {
  const { workouts, exercises } = useProfileSnapshot();
  const snapshot = tab === 'exercises' ? exercises : workouts;
  const names = tab === 'exercises' ? exercises.data?.map(row => row.name) : workouts.data &&
    selectProfileWorkoutRows({ ...workouts.data, actorUserId: cloud?.actorUserId, contact: client,
      mode: tab === 'calendar' ? 'plan' : 'history', today: '2026-11-08' })
      .map(row => row.kind === 'completed' ? row.session.name : row.occurrence.plan.name);
  return <>
    {snapshot.failed ? <div role="alert">Ошибка чтения <button onClick={snapshot.retry}>Повторить</button></div> : null}
    {!snapshot.data && !snapshot.failed ? <p>Первичное чтение</p> : null}
    {names && <ul>{names.map(name => <li key={name}>{name}</li>)}</ul>}
  </>;
}

function profile(tab: ProfileTab, client?: CloudContact) {
  return <ProfileDataProvider tab={tab} contact={client}>
    {tab === 'basics' ? <p>Анкета</p> : <Rows key={tab} tab={tab} client={client} />}
  </ProfileDataProvider>;
}

it('keeps one local workout observer across tabs and updates open History after IndexedDB writes', async () => {
  const db = await fixture();
  await db.workoutOccurrences.bulkAdd([booking('Будущая', future), booking('Пропущенная', past)]);
  await db.adHocSessions.bulkAdd(Array.from({ length: 9 }, (_, index) => completed('Тренировка ' + index)));
  const observe = vi.spyOn(WorkoutOccurrenceDraftRepository.prototype, 'observeWorkspace');
  const view = render(profile('basics'));
  expect(observe).not.toHaveBeenCalled();
  view.rerender(profile('calendar'));
  expect(screen.getByText('Первичное чтение')).toBeTruthy();
  await screen.findByText('Будущая');
  view.rerender(profile('history'));
  expect(screen.queryByText('Первичное чтение')).toBeNull();
  expect(screen.getAllByRole('listitem')).toHaveLength(10);
  view.rerender(profile('calendar'));
  expect(screen.getByText('Будущая')).toBeTruthy();
  expect(observe).toHaveBeenCalledOnce();

  const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
  window.dispatchEvent(new Event('offline'));
  view.rerender(profile('history'));
  expect(screen.queryByText('Первичное чтение')).toBeNull();
  expect(screen.getAllByRole('listitem')).toHaveLength(10);

  online.mockReturnValue(true);
  window.dispatchEvent(new Event('online'));
  // A local Dexie transaction is the same observation boundary used by Addon replication.
  await db.adHocSessions.add(completed('Новая тренировка'));
  await screen.findByText('Новая тренировка');
  expect(screen.getAllByRole('listitem')).toHaveLength(11);
  await db.workoutOccurrences.update('Пропущенная', { plan: plan('Переименованная') });
  await screen.findByText('Переименованная');
  await db.workoutOccurrences.update('Пропущенная', { status: 'cancelled', cancelledAt: past });
  await waitFor(() => expect(screen.queryByText('Переименованная')).toBeNull());
  await db.adHocSessions.delete('Новая тренировка');
  await waitFor(() => expect(screen.queryByText('Новая тренировка')).toBeNull());
  expect(observe).toHaveBeenCalledOnce();
});

it('clears the old scope before a new client or account paints and cleans up every subscription', async () => {
  const db = await fixture();
  const first = await relationshipMembership('101', '202');
  const second = await relationshipMembership('101', '303');
  for (const pair of [first, second]) {
    await db.realms.add(pair.realm);
    await db.members.bulkAdd(pair.members);
  }
  const anna = contact('202', first.realm.realmId);
  const maria = contact('303', second.realm.realmId);
  await db.workoutOccurrences.bulkAdd([
    booking('План Анны', future, anna), booking('План Марии', future, maria),
  ]);
  const original = WorkoutOccurrenceDraftRepository.prototype.observeWorkspace;
  const stop = vi.fn();
  const observe = vi.spyOn(WorkoutOccurrenceDraftRepository.prototype, 'observeWorkspace')
    .mockImplementation(function (this: WorkoutOccurrenceDraftRepository, next, error) {
      const subscription = original.call(this, next, error);
      return { ...subscription, unsubscribe: () => { subscription.unsubscribe(); stop(); } };
    });
  const view = render(profile('calendar', anna));
  await screen.findByText('План Анны');
  expect(screen.queryByText('План Марии')).toBeNull();
  view.rerender(profile('calendar', maria));
  expect(screen.queryByText('План Анны')).toBeNull();
  await screen.findByText('План Марии');
  // Membership changes also invalidate the read when the selected contact is still mounted.
  await db.members.delete(second.members[1].id);
  await waitFor(() => expect(screen.queryByText('План Марии')).toBeNull());

  cloud = { db, actorUserId: 'tg:404', coaches: [] };
  await db.adHocSessions.add(completed('Личная история', 'tg:404'));
  view.rerender(profile('history'));
  expect(screen.queryByText('План Марии')).toBeNull();
  await screen.findByText('Личная история');
  view.unmount();
  expect(stop).toHaveBeenCalledTimes(3);

  render(profile('history'));
  expect(screen.getByText('Первичное чтение')).toBeTruthy();
  await screen.findByText('Личная история');
  expect(observe).toHaveBeenCalledTimes(4);
});

it('keeps the last successful result through an observer error and retry', async () => {
  const db = await fixture();
  await db.adHocSessions.add(completed('Локальная тренировка'));
  const original = WorkoutOccurrenceDraftRepository.prototype.observeWorkspace;
  let fail: ((reason: unknown) => void) | undefined;
  vi.spyOn(WorkoutOccurrenceDraftRepository.prototype, 'observeWorkspace')
    .mockImplementationOnce(function (this: WorkoutOccurrenceDraftRepository, next, error) {
      const subscription = original.call(this, next, error);
      fail = reason => { subscription.unsubscribe(); error(reason); };
      return subscription;
    });
  render(profile('history'));
  await screen.findByText('Локальная тренировка');
  act(() => fail?.(new Error('IndexedDB read failed')));
  expect(screen.getByRole('alert')).toBeTruthy();
  expect(screen.getByText('Локальная тренировка')).toBeTruthy();
  fireEvent.click(screen.getByText('Повторить'));
  expect(screen.queryByText('Первичное чтение')).toBeNull();
  expect(screen.getByText('Локальная тренировка')).toBeTruthy();
  await db.adHocSessions.add(completed('После повтора'));
  await screen.findByText('После повтора');
  expect(screen.queryByRole('alert')).toBeNull();
});

it('shows the initial read error and starts a new subscription on retry', async () => {
  const db = await fixture();
  await db.adHocSessions.add(completed('После восстановления'));
  vi.spyOn(WorkoutOccurrenceDraftRepository.prototype, 'observeWorkspace').mockImplementationOnce((_next, error) => {
    error(new Error('IndexedDB unavailable'));
    return { unsubscribe() {}, closed: true };
  });
  render(profile('history'));
  expect(screen.getByRole('alert')).toBeTruthy();
  expect(screen.queryByRole('list')).toBeNull();
  fireEvent.click(screen.getByText('Повторить'));
  await screen.findByText('После восстановления');
});

it('retains the independent FACT projection while visiting other profile tabs', async () => {
  const db = await fixture();
  await db.adHocSessions.add(completed('session'));
  await db.adHocExercises.add({
    id: 'exercise', sessionId: 'session', realmId: 'tg:101', owner: 'tg:101', position: 0,
    notes: null, deletedAt: null, exercise: { exerciseDefinitionId: 'press', scope: 'public',
      name: 'Жим', nameEn: null, mediaUrl: null, trackingType: 'weight_reps' },
  });
  await db.adHocSets.add({
    id: 'set', exerciseId: 'exercise', sessionId: 'session', realmId: 'tg:101', owner: 'tg:101',
    position: 0, deletedAt: null, setType: null, actualReps: 8, actualWeightKg: null,
    actualDurationSeconds: null, actualDistanceMeters: null, setLabel: null, rpe: null,
    comment: null, bands: [], setStatus: 'completed',
  });
  const observe = vi.spyOn(AdHocWorkoutRepository.prototype, 'observeOwnExerciseFacts');
  const view = render(profile('exercises'));
  await screen.findByText('Жим');
  view.rerender(profile('history'));
  view.rerender(profile('exercises'));
  expect(screen.queryByText('Первичное чтение')).toBeNull();
  expect(screen.getByText('Жим')).toBeTruthy();
  await db.adHocSets.update('set', { deletedAt: past });
  await waitFor(() => expect(screen.queryByText('Жим')).toBeNull());
  expect(observe).toHaveBeenCalledOnce();
});
