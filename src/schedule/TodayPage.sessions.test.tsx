// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { CLOUD_DATABASE_STORES_V12, type MezfitCloudDatabase } from '../data/cloud/database';
import type { DayScheduleEvent, DayScheduleEventCardProps, DayScheduleRenderState } from '../ui';
import { TodayPage } from './TodayPage';

const state = vi.hoisted(() => ({ db: null as MezfitCloudDatabase | null }));
vi.mock('../data/cloud/CloudConnectionsProvider', () => ({ useCloudConnections: () => ({
  db: state.db, actorUserId: 'tg:101', clients: [], coaches: [], syncStatus: 'offline',
}) }));
vi.mock('../NavigationShell', async original => ({ ...await original<typeof import('../NavigationShell')>(), useNavigationSurfaceFloatingAction: () => {} }));
vi.mock('../workout/PlannedWorkoutStartContext', () => ({ usePlannedWorkoutStart: () => null }));
vi.mock('./OccurrenceDraftSheet', () => ({ OccurrenceDraftSheet: () => null }));
vi.mock('./CalendarSessionSheet', () => ({ CalendarSessionSheet: ({ sessionId }: { sessionId: string | null }) => sessionId ? <div>Открыта сессия {sessionId}</div> : null }));
vi.mock('../ui', async original => ({ ...await original<typeof import('../ui')>(),
  DaySchedule: ({ eventsByDate, renderEvent, isEventEditable }: {
    eventsByDate: Record<string, DayScheduleEvent[]>;
    renderEvent: (event: DayScheduleEvent, state: DayScheduleRenderState) => ReactNode;
    isEventEditable: (event: DayScheduleEvent) => boolean;
  }) => <div>{Object.entries(eventsByDate).flatMap(([date, events]) => events.map(event => <section key={event.id}
    data-testid={event.id} data-date={date} data-start={event.startMinutes} data-duration={event.durationMinutes}
    data-editable={String(isEventEditable(event))}>
    {renderEvent(event, { startMinutes: event.startMinutes, durationMinutes: event.durationMinutes, compact: false, editing: false, lifted: false, height: 80 })}
  </section>))}</div>,
  DayScheduleEventCard: ({ detail, status, timeLabel, onClick }: DayScheduleEventCardProps) => <button onClick={onClick}>{detail} {status} {timeLabel}</button>,
}));
let db: Dexie;
const plannedStart = '2026-10-29T08:00:00.000Z';
beforeEach(async () => {
  db = new Dexie('actual-calendar-' + crypto.randomUUID(), { addons: [] });
  const stores: Record<string, string | null> = {};
  for (const [table, schema] of Object.entries(CLOUD_DATABASE_STORES_V12)) stores[table] = schema?.replaceAll('@', '') ?? null;
  db.version(12).stores({ ...stores, localProgramSync: 'id', localWorkoutSync: 'id' });
  state.db = db as MezfitCloudDatabase;
  await db.table('workoutOccurrences').put({ id: 'planned', realmId: 'tg:101', owner: 'tg:101',
    athleteUserId: 'tg:101', coachUserId: null, clientUserId: null, format: 'independent',
    status: 'in_progress', workoutSessionId: 'execution', startsAtUtc: plannedStart, durationMinutes: 60,
    plan: { name: 'День А', comment: null, exercises: [] } });
  await db.table('adHocSessions').put({ id: 'execution', realmId: 'tg:101', owner: 'tg:101',
    athleteUserId: 'tg:101', coachUserId: null, clientUserId: null, creatorUserId: 'tg:101',
    name: 'День А', comment: null, programName: null, autoCreatedProgram: false,
    occurrenceId: 'planned', occurrencePlan: { name: 'День А', comment: null, exercises: [] },
    startedAt: '2026-10-28T10:05:00.000Z', completedAt: null, status: 'active',
    createdAt: '2026-10-28T10:05:00.000Z', updatedAt: '2026-10-28T10:05:00.000Z' });
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-28T10:20:00.000Z'));
});
afterEach(async () => { cleanup(); vi.useRealTimers(); await db.delete(); });

it('replaces the scheduled position with one actual execution and freezes the end on completion', async () => {
  render(<TodayPage initData="" role="coach" onNavigationContextChange={() => {}} />);
  const event = await screen.findByTestId('session:execution:0');
  expect(event.getAttribute('data-date')).toBe('2026-10-28');
  expect(event.getAttribute('data-duration')).toBe('15');
  expect(event.getAttribute('data-editable')).toBe('false');
  expect(screen.queryByTestId('occurrence:planned:0')).toBeNull();
  expect(screen.getByText('Запущена')).toBeTruthy();
  await act(async () => { vi.setSystemTime(new Date('2026-10-28T10:21:00.000Z')); document.dispatchEvent(new Event('visibilitychange')); });
  expect(event.getAttribute('data-duration')).toBe('16');
  await act(async () => { await db.table('adHocSessions').update('execution', { status: 'completed', completedAt: '2026-10-28T10:25:00.000Z' }); });
  await screen.findByText('Завершена');
  await act(async () => { vi.setSystemTime(new Date('2026-10-28T10:30:00.000Z')); document.dispatchEvent(new Event('visibilitychange')); });
  expect(screen.getByTestId('session:execution:0').getAttribute('data-duration')).toBe('20');
  expect((await db.table('workoutOccurrences').get('planned')).startsAtUtc).toBe(plannedStart);
  fireEvent.click(screen.getByRole('button', { name: /День А/ }));
  expect(screen.getByText('Открыта сессия execution')).toBeTruthy();
});
it('shows an unplanned session and leaves an overlapping upcoming booking visible', async () => {
  await db.table('adHocSessions').update('execution', { occurrenceId: undefined, occurrencePlan: undefined });
  await db.table('workoutOccurrences').update('planned', { status: 'scheduled', workoutSessionId: null,
    startsAtUtc: '2026-10-28T10:15:00.000Z' });
  render(<TodayPage initData="" role="coach" onNavigationContextChange={() => {}} />);
  await screen.findByTestId('session:execution:0');
  expect(screen.getByTestId('occurrence:planned:0').getAttribute('data-editable')).toBe('true');
});
it('segments a completed session across midnight and does not restore its old planned position', async () => {
  await db.table('adHocSessions').update('execution', { startedAt: '2026-10-28T23:50:00.000Z', status: 'completed', completedAt: '2026-10-29T00:20:00.000Z' });
  render(<TodayPage initData="" role="coach" onNavigationContextChange={() => {}} />);
  const first = await screen.findByTestId('session:execution:0');
  const second = screen.getByTestId('session:execution:1');
  expect(first.getAttribute('data-date')).toBe('2026-10-28');
  expect(first.getAttribute('data-duration')).toBe('10');
  expect(second.getAttribute('data-date')).toBe('2026-10-29');
  expect(second.getAttribute('data-duration')).toBe('20');
  expect(screen.queryByTestId('occurrence:planned:0')).toBeNull();
});
