// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import type { MezfitCloudDatabase } from '../data/cloud/database';
import type { DayScheduleEvent, DayScheduleEventCardProps, DayScheduleRenderState } from '../ui';
import type { OccurrenceDraftSheetProps } from './OccurrenceDraftSheet';
import { TodayPage } from './TodayPage';

const state = vi.hoisted(() => ({ db: null as MezfitCloudDatabase | null, closed: null as null | (() => void) }));
vi.mock('../data/cloud/CloudConnectionsProvider', () => ({ useCloudConnections: () => ({ db: state.db, actorUserId: 'tg:101', clients: [], coaches: [], syncStatus: 'offline' }) }));
vi.mock('../NavigationShell', async original => ({ ...await original<typeof import('../NavigationShell')>(), useNavigationSurfaceFloatingAction: () => {} }));
vi.mock('../workout/PlannedWorkoutStartContext', () => ({ usePlannedWorkoutStart: () => null }));
vi.mock('./OccurrenceDraftSheet', () => ({ OccurrenceDraftSheet: (props: OccurrenceDraftSheetProps) => {
  state.closed = props.onClosed ?? null;
  const { draft } = props;
  return draft ? <section aria-label="Открытая тренировка">
    {props.onCancel ? <button onClick={() => props.onCancel?.(draft)}>Отменить тренировку</button> : null}
    {props.onDelete ? <button onClick={() => { void props.onDelete?.(draft); }}>Удалить</button> : null}
    <button onClick={props.onClose}>Закрыть</button>
  </section> : null;
} }));
vi.mock('../ui', async original => ({ ...await original<typeof import('../ui')>(),
  DaySchedule: ({ eventsByDate, renderEvent }: { eventsByDate: Record<string, DayScheduleEvent[]>;
    renderEvent: (event: DayScheduleEvent, state: DayScheduleRenderState) => ReactNode }) => <div>
    {Object.values(eventsByDate).flat().map(event => <div key={event.id}>{renderEvent(event, {
      startMinutes: event.startMinutes, durationMinutes: event.durationMinutes, compact: false, editing: false, lifted: false, height: 80,
    })}</div>)}
  </div>,
  DayScheduleEventCard: ({ title, detail, status, onClick }: DayScheduleEventCardProps) => <button onClick={onClick}>{title} {status} {detail}</button>,
}));
let db: Dexie;
beforeEach(async () => {
  db = new Dexie('today-cancellation-' + crypto.randomUUID());
  db.version(1).stores({ workoutOccurrences: 'id, realmId', localWorkoutSync: 'id', realms: 'realmId', members: 'id, realmId' });
  state.db = db as MezfitCloudDatabase;
  await db.table('workoutOccurrences').put({ id: 'workout', realmId: 'tg:101', owner: 'tg:101',
    athleteUserId: 'tg:101', coachUserId: null, clientUserId: null, format: 'independent',
    status: 'scheduled', workoutSessionId: null, publicationStatus: 'published',
    startsAtUtc: '2026-10-28T10:00:00.000Z', durationMinutes: 60,
    plan: { name: 'Силовая', comment: null, exercises: [] } });
});
afterEach(async () => { cleanup(); await db.delete(); });
it('closes before cancellation, toggles the basket and logically deletes without resurrecting the card', async () => {
  render(<TodayPage initData="" role="coach" onNavigationContextChange={vi.fn()} />);
  fireEvent.click(await screen.findByRole('button', { name: /Силовая/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Отменить тренировку' }));
  expect((await db.table('workoutOccurrences').get('workout')).cancelledAt).toBeUndefined();
  expect(screen.queryByLabelText('Открытая тренировка')).toBeNull();
  act(() => state.closed?.());
  await waitFor(() => expect(screen.queryByRole('button', { name: /Силовая/ })).toBeNull());
  fireEvent.click(screen.getByRole('button', { name: 'Отменённые тренировки' }));
  fireEvent.click(await screen.findByRole('button', { name: /Силовая/ }));
  expect(screen.queryByRole('button', { name: 'Отменить тренировку' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Удалить' }));
  await waitFor(() => expect(screen.queryByRole('button', { name: /Силовая/ })).toBeNull());
  expect(await db.table('workoutOccurrences').get('workout')).toMatchObject({ inactive: true, cancelledAt: expect.any(String), plan: { name: 'Силовая' } });
  fireEvent.click(screen.getByRole('button', { name: 'Отменённые тренировки' }));
  expect(screen.queryByRole('button', { name: /Силовая/ })).toBeNull();
});
it('keeps the original card and reports an error when cancellation cannot be stored', async () => {
  db.table('workoutOccurrences').hook('updating', changes => {
    if ('cancelledAt' in changes) throw new Error('Нет места');
  });
  render(<TodayPage initData="" role="coach" onNavigationContextChange={vi.fn()} />);
  fireEvent.click(await screen.findByRole('button', { name: /Силовая/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Отменить тренировку' }));
  act(() => state.closed?.());
  await screen.findByRole('alert');
  expect(screen.getByRole('button', { name: /Силовая/ })).toBeTruthy();
  expect((await db.table('workoutOccurrences').get('workout')).cancelledAt).toBeUndefined();
});
