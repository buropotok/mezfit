// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { relationshipMembership } from '../../worker/lib/dexie-cloud-membership';
import type { MezfitCloudDatabase } from '../data/cloud/database';
import type { DayScheduleEvent, DayScheduleEventCardProps, DayScheduleRenderState } from '../ui';
import type { OccurrenceDraftSheetProps } from './OccurrenceDraftSheet';
import { TodayPage } from './TodayPage';

const state = vi.hoisted(() => ({ db: null as MezfitCloudDatabase | null }));
vi.mock('../data/cloud/CloudConnectionsProvider', () => ({ useCloudConnections: () => ({
  db: state.db, actorUserId: 'tg:101', clients: [], coaches: [], syncStatus: 'offline',
}) }));
vi.mock('../NavigationShell', async original => ({ ...await original<typeof import('../NavigationShell')>(), useNavigationSurfaceFloatingAction: () => {} }));
vi.mock('../workout/PlannedWorkoutStartContext', () => ({ usePlannedWorkoutStart: () => null }));
vi.mock('./OccurrenceDraftSheet', () => ({ OccurrenceDraftSheet: (props: OccurrenceDraftSheetProps) => props.draft
  ? <section aria-label="Открытая тренировка" data-readonly={String(props.readOnly)}>
    {props.onCancel ? <button>Отменить тренировку</button> : null}
    {props.onDelete ? <button>Удалить тренировку</button> : null}
    <button onClick={props.onClose}>Закрыть тренировку</button>
  </section> : null }));
vi.mock('../ui', async original => ({ ...await original<typeof import('../ui')>(),
  DaySchedule: ({ eventsByDate, renderEvent, isEventEditable }: {
    eventsByDate: Record<string, DayScheduleEvent[]>;
    renderEvent: (event: DayScheduleEvent, state: DayScheduleRenderState) => ReactNode;
    isEventEditable: (event: DayScheduleEvent) => boolean;
  }) => <div>{Object.values(eventsByDate).flat().map(event => <div key={event.id}
    data-testid="calendar-event" data-editable={String(isEventEditable(event))}>
    {renderEvent(event, { startMinutes: event.startMinutes, durationMinutes: event.durationMinutes,
      compact: false, editing: false, lifted: false, height: 80 })}
  </div>)}</div>,
  DayScheduleEventCard: ({ detail, onClick }: DayScheduleEventCardProps) => <button onClick={onClick}>{detail}</button>,
}));
let db: Dexie;
beforeEach(async () => {
  db = new Dexie('calendar-actions-' + crypto.randomUUID());
  db.version(1).stores({ workoutOccurrences: 'id, realmId', localWorkoutSync: 'id', realms: 'realmId', members: 'id, realmId' });
  state.db = db as MezfitCloudDatabase;
});
afterEach(async () => { cleanup(); await db.delete(); });

it('keeps an existing coached booking editable and hides both floating actions while its sheet is open', async () => {
  const pair = await relationshipMembership('101', '202');
  await db.table('realms').put(pair.realm);
  await db.table('members').bulkPut(pair.members);
  // Existing published booking, without newer optional draft/cancellation fields.
  await db.table('workoutOccurrences').put({ id: 'existing', realmId: pair.realm.realmId, owner: null,
    athleteUserId: 'tg:202', coachUserId: 'tg:101', clientUserId: 'tg:202', format: 'coached',
    status: 'scheduled', workoutSessionId: null, startsAtUtc: '2026-10-28T08:00:00.000Z', durationMinutes: 60,
    plan: { name: 'Старая плановая тренировка', comment: null, exercises: [] } });
  render(<TodayPage initData="" role="coach" onNavigationContextChange={() => {}} />);
  const card = await screen.findByRole('button', { name: 'Старая плановая тренировка' });
  expect(screen.getByTestId('calendar-event').getAttribute('data-editable')).toBe('true');
  fireEvent.click(card);
  expect(screen.getByLabelText('Открытая тренировка').getAttribute('data-readonly')).toBe('false');
  expect(screen.getByRole('button', { name: 'Отменить тренировку' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Удалить тренировку' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Поиск клиента' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Отменённые тренировки' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Закрыть тренировку' }));
  expect(screen.getByRole('button', { name: 'Поиск клиента' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Отменённые тренировки' })).toBeTruthy();
  expect(await db.table('workoutOccurrences').get('existing')).toMatchObject({ status: 'scheduled', workoutSessionId: null });
});

it('puts the client basket in the first action slot without a search button', async () => {
  render(<TodayPage initData="" role="client" onNavigationContextChange={() => {}} />);
  await waitFor(() => expect(screen.getByLabelText('Расписание').getAttribute('aria-busy')).toBeNull());
  expect(screen.queryByRole('button', { name: 'Поиск клиента' })).toBeNull();
  const basket = screen.getByRole('button', { name: 'Отменённые тренировки' });
  expect(basket.parentElement?.classList.contains('today-page__basket--first')).toBe(true);
});
