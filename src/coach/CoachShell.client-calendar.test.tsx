// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { NavigationContext } from '../NavigationShell';
import type { CalendarWorkoutSession } from '../data/cloud/adhoc-workouts';
import { WorkoutOccurrenceDraftRepository } from '../data/cloud/workout-occurrence-drafts';
import type { CloudWorkoutOccurrenceRow } from '../data/cloud/workout-foundation-types';
import { CoachShell } from './CoachShell';

const cloud = vi.hoisted(() => ({
  db: {}, status: 'ready', actorUserId: 'tg:101',
  clients: [{ userId: 'tg:202', telegramUserId: '202', relationshipId: 'pair', displayName: 'Анна' }],
}));

vi.mock('../data/cloud/CloudConnectionsProvider', () => ({ useCloudConnections: () => cloud }));
vi.mock('../contacts/CloudContactAvatar', () => ({
  CloudContactAvatar: () => null, useCloudContactAvatarUrl: () => undefined,
}));
vi.mock('../profile/PublishedUserProfile', () => ({ PublishedUserProfile: () => <p>Анкета</p> }));
vi.mock('../schedule/OccurrenceDraftSheet', () => ({
  OccurrenceDraftSheet: ({ draft }: { draft: { id: string } | null }) =>
    draft ? <div role="dialog" aria-label={draft.id} /> : null,
}));
vi.mock('../schedule/CalendarSessionSheet', () => ({
  CalendarSessionSheet: ({ sessionId, onClose }: { sessionId: string | null; onClose: () => void }) =>
    sessionId ? <button onClick={onClose}>Закрыть {sessionId}</button> : null,
}));

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const pair = {
  realmId: 'pair', owner: 'pair', athleteUserId: 'tg:202', coachUserId: 'tg:101', clientUserId: 'tg:202',
  format: 'coached' as const,
};
const singleDay = '2026-10-10';
const multipleDay = '2026-10-11';
const plannedDay = '2098-10-12';

function completed(id: string, day: string): CalendarWorkoutSession {
  const time = day + 'T12:00:00';
  return { ...pair, id, name: id, creatorUserId: 'tg:101', status: 'completed', startedAt: time,
    completedAt: time, createdAt: time, updatedAt: time, comment: null, programName: null, autoCreatedProgram: false };
}

it('filters client History by a calendar day and opens details only for a single workout', () => {
  let publish: Parameters<WorkoutOccurrenceDraftRepository['observeWorkspace']>[0] | undefined;
  vi.spyOn(WorkoutOccurrenceDraftRepository.prototype, 'observeWorkspace').mockImplementation(next => {
    publish = next;
    return { unsubscribe() {}, closed: false };
  });
  const onNavigation = vi.fn<(context: NavigationContext | null) => void>();
  const context = () => onNavigation.mock.lastCall?.[0];
  render(<CoachShell initData="test" destination="clients" onNavigationContextChange={onNavigation} />);
  fireEvent.click(screen.getByRole('button', { name: 'Открыть клиента Анна' }));

  const openCalendar = context()?.onCalendarOpen;
  expect(openCalendar).toBeDefined();
  act(() => openCalendar?.());
  expect(screen.getByRole('region', { name: 'История тренировок' })).toBeTruthy();
  const selectDay = (day: string) => {
    const calendar = context()?.calendar;
    expect(calendar?.closeOnSelect).toBe(true);
    act(() => calendar?.onChange(day));
  };

  selectDay(singleDay);
  const planned: CloudWorkoutOccurrenceRow = {
    ...pair, id: 'planned', startsAtUtc: plannedDay + 'T12:00:00', durationMinutes: 60,
    status: 'scheduled', workoutSessionId: null, publicationStatus: 'published',
    plan: { name: 'План', comment: null, category: null, exercises: [] },
  };
  act(() => publish?.({ occurrences: [planned], drafts: [], sessions: [
    completed('Одна', singleDay), completed('Первая', multipleDay), completed('Вторая', multipleDay),
    { ...completed('Чужая', singleDay), realmId: 'other-pair' },
  ] }));
  fireEvent.click(screen.getByRole('button', { name: 'Закрыть Одна' }));
  expect(screen.queryByRole('button', { name: 'Закрыть Одна' })).toBeNull();
  expect(context()?.calendar?.dayStatuses).toEqual(expect.arrayContaining([
    { date: singleDay, status: 'completed' },
    { date: multipleDay, status: 'completed' },
    { date: plannedDay, status: 'scheduled' },
  ]));
  expect(screen.queryByRole('button', { name: /Чужая/ })).toBeNull();

  selectDay(multipleDay);
  expect(screen.getAllByRole('button', { name: /^Завершённая тренировка:/ })).toHaveLength(2);
  expect(screen.queryByRole('button', { name: /^Закрыть/ })).toBeNull();

  selectDay(plannedDay);
  expect(screen.getByRole('button', { name: 'Запланированная тренировка: План' })).toBeTruthy();
  expect(screen.getByRole('dialog', { name: 'draft:planned' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: /^Завершённая тренировка:/ })).toBeNull();
});
