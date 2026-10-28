// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { CLOUD_DATABASE_STORES_V12, type MezfitCloudDatabase } from '../data/cloud/database';
import type { DayScheduleEvent, DayScheduleEventCardProps, DayScheduleRenderState } from '../ui';
import { TodayPage } from './TodayPage';
import { relationshipMembership } from '../../worker/lib/dexie-cloud-membership';
import { SchedulePlanningContext } from './SchedulePlanningContext';
import { AdHocWorkoutRepository } from '../data/cloud/adhoc-workouts';
import { eventGeometry, FULL_EVENT_CARD_HEIGHT } from '../ui/day-schedule/DayPanel';

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
  }) => <div>{Object.entries(eventsByDate).flatMap(([date, events]) => events.map(event => {
    const geometry = eventGeometry(event);
    if (!geometry) return null;
    return <section key={event.id}
    data-testid={event.id} data-date={date} data-start={event.startMinutes} data-duration={event.durationMinutes}
    data-height={geometry.height} data-editable={String(isEventEditable(event))}>
    {renderEvent(event, { startMinutes: event.startMinutes, durationMinutes: event.durationMinutes,
      compact: geometry.height < FULL_EVENT_CARD_HEIGHT, editing: false, lifted: false, height: geometry.height })}
  </section>;}))}</div>,
  DayScheduleEventCard: ({ detail, status, timeLabel, media, corner, onClick }: DayScheduleEventCardProps) => <button onClick={onClick}>
    <span data-calendar-media>{media}</span>{detail} {status} {timeLabel}<span data-calendar-icon>{corner}</span>
  </button>,
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
  expect(event.textContent).toContain('10:05–…');
  expect(event.querySelector('[data-calendar-media] .ui-avatar')).toBeTruthy();
  expect(event.querySelector('[data-calendar-icon] .ui-icon')).toBeTruthy();
  expect(event.querySelector('[data-calendar-icon] .ui-avatar')).toBeNull();
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

it('renders a just-started session on one date with a quarter-hour frame and no invented end', async () => {
  vi.setSystemTime(new Date('2026-10-28T23:59:59.000Z'));
  await db.table('adHocSessions').update('execution', { startedAt: '2026-10-28T23:59:59.000Z' });
  render(<TodayPage initData="" role="coach" onNavigationContextChange={() => {}} />);
  const event = await screen.findByTestId('session:execution:0');
  expect(event.getAttribute('data-duration')).toBe('0');
  expect(event.getAttribute('data-height')).toBe('16');
  expect(event.getAttribute('data-date')).toBe('2026-10-28');
  expect(screen.queryByTestId('session:execution:1')).toBeNull();
  expect(event.textContent).toContain('23:59–…');
});

it('starting one plan changes neither unrelated bookings nor completed coach/client execution intervals', async () => {
  const pair = await relationshipMembership('101', '202');
  await db.table('realms').put(pair.realm); await db.table('members').bulkPut(pair.members);
  await db.table('adHocSessions').update('execution', { status: 'completed', completedAt: '2026-10-28T10:10:00.000Z' });
  await db.table('workoutOccurrences').update('planned', { status: 'completed' });
  const original = await db.table('workoutOccurrences').get('planned');
  const session = await db.table('adHocSessions').get('execution');
  const participants = { realmId: pair.realm.realmId, owner: pair.realm.realmId,
    athleteUserId: 'tg:202', coachUserId: 'tg:101', clientUserId: 'tg:202' };
  await db.table('workoutOccurrences').put({ ...original, ...participants, id: 'client-history', format: 'coached',
    workoutSessionId: 'client-session' });
  await db.table('adHocSessions').put({ ...session, ...participants, id: 'client-session', occurrenceId: 'client-history',
    startedAt: '2026-10-28T08:00:00.000Z', completedAt: '2026-10-28T10:00:00.000Z' });
  const upcoming = { ...original, ...participants, id: 'upcoming', format: 'coached', status: 'scheduled',
    workoutSessionId: null, startsAtUtc: '2026-10-29T12:00:00.000Z', durationMinutes: 90 };
  await db.table('workoutOccurrences').put(upcoming);
  await db.table('workoutOccurrences').put({ ...original, id: 'target', status: 'scheduled', workoutSessionId: null });
  db.table('adHocSessions').hook('creating', key => key === undefined ? crypto.randomUUID() : undefined);
  render(<TodayPage initData="" role="coach" onNavigationContextChange={() => {}} />);
  await screen.findByTestId('session:client-session:0');
  const before = ['session:execution:0', 'session:client-session:0', 'occurrence:upcoming:0'].map(id => {
    const element = screen.getByTestId(id);
    return { id, start: element.getAttribute('data-start'), duration: element.getAttribute('data-duration'), height: element.getAttribute('data-height') };
  });
  let startedId = '';
  await act(async () => { startedId = (await new AdHocWorkoutRepository(state.db!, 'tg:101').createFromOccurrence('target')).id; });
  await screen.findByTestId(`session:${startedId}:0`);
  await act(async () => { vi.setSystemTime(new Date('2026-10-28T11:20:00.000Z')); document.dispatchEvent(new Event('visibilitychange')); });
  for (const snapshot of before) {
    const element = screen.getByTestId(snapshot.id);
    expect(element.getAttribute('data-start')).toBe(snapshot.start);
    expect(element.getAttribute('data-duration')).toBe(snapshot.duration);
    expect(element.getAttribute('data-height')).toBe(snapshot.height);
  }
  expect(await db.table('workoutOccurrences').get('upcoming')).toEqual(upcoming);
  expect(await db.table('adHocSessions').get('execution')).toEqual(session);
  expect((await db.table('workoutOccurrences').get('planned')).startsAtUtc).toBe(plannedStart);
  expect(screen.getByTestId(`session:${startedId}:0`).getAttribute('data-duration')).toBe('60');
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

it.each(['independent', 'coached'] as const)('keeps %s execution in the correct coach calendar context', async format => {
  const pair = await relationshipMembership('101', '202');
  await db.table('realms').put(pair.realm);
  await db.table('members').bulkPut(pair.members);
  const participants = { realmId: pair.realm.realmId, owner: pair.realm.realmId,
    athleteUserId: 'tg:202', coachUserId: 'tg:101', clientUserId: 'tg:202' };
  await db.table('workoutOccurrences').update('planned', { ...participants, format });
  await db.table('adHocSessions').update('execution', participants);
  const view = render(<TodayPage initData="" role="coach" onNavigationContextChange={() => {}} />);
  await waitFor(() => expect(screen.getByLabelText('Расписание').getAttribute('aria-busy')).toBeNull());
  if (format === 'independent') expect(screen.queryByTestId('session:execution:0')).toBeNull();
  else expect(screen.getByTestId('session:execution:0')).toBeTruthy();
  view.rerender(<SchedulePlanningContext.Provider value={{ requestedDraftId: 'planned', requestedClientUserId: 'tg:202',
    openDraft: () => {}, clearDraft: () => {} }}>
    <TodayPage initData="" role="coach" onNavigationContextChange={() => {}} />
  </SchedulePlanningContext.Provider>);
  expect(await screen.findByTestId('session:execution:0')).toBeTruthy();
  expect(screen.queryByTestId('occurrence:planned:0')).toBeNull();
});
