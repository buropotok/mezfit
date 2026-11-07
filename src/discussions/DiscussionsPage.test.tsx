// @vitest-environment jsdom
import { useEffect } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NavigationContext } from '../NavigationShell';
import { DiscussionsPage, DiscussionInboxList } from './DiscussionsPage';
import type { DiscussionInboxRow } from './DiscussionsProvider';
import { thread, message } from './discussion-fixture.test-support';

const state = vi.hoisted(() => ({ rows: [] as DiscussionInboxRow[], ensure: vi.fn(), cloudStatus: 'ready', syncStatus: 'offline' }));
vi.mock('./DiscussionsProvider', () => ({ useDiscussions: () => ({ rows: state.rows, unread: 0, loading: false, error: '', retry: vi.fn() }) }));
vi.mock('../navigation/NavigationSurfaceContext', () => ({ useNavigationSurfaceContext: () => null }));
vi.mock('../data/cloud/CloudConnectionsProvider', () => ({ useCloudConnections: () => ({ db: {}, actorUserId: 'tg:11',
  clients: [peer('pair', 'Анна'), peer('other-pair', 'Ольга')], status: state.cloudStatus, syncStatus: state.syncStatus }) }));
vi.mock('../contacts/CloudContactAvatar', () => ({ CloudContactAvatar: ({ contact }: { contact: { displayName: string } }) => <span>{contact.displayName}</span> }));
vi.mock('../data/cloud/discussions', () => ({ DiscussionRepository: class { ensureEntityThread = state.ensure; } }));
vi.mock('./DiscussionSheet', () => ({ DiscussionSheet: ({ threadId, onClose, onNavigationContextChange }: {
  threadId: string; onClose: () => void; onNavigationContextChange: (value: NavigationContext | null) => void;
}) => {
  useEffect(() => { onNavigationContextChange({ level: 2, title: 'Чат', onBack: onClose }); }, [onClose, onNavigationContextChange]);
  return <div role="dialog" aria-label={threadId}><button onClick={onClose}>Закрыть диалог</button></div>;
} }));
vi.mock('./DiscussionEntity', () => ({ DiscussionEntity: ({ thread, onBack }: { thread: { id: string }; onBack: () => void }) =>
  <div>Сущность {thread.id}<button onClick={onBack}>Назад в список</button></div> }));
vi.mock('../ui', async importOriginal => {
  const actual = await importOriginal<typeof import('../ui')>();
  return { ...actual, DatePicker: ({ opened, onChange }: { opened: boolean; onChange: (value: string) => void }) => opened
    ? <button onClick={() => onChange('2026-11-07')}>Выбрать 7 ноября</button> : null };
});
function peer(relationshipId: string, displayName: string) {
  return { relationshipId, displayName, userId: relationshipId === 'pair' ? 'tg:22' : 'tg:44', telegramUserId: '22' };
}
function row(id: string, realmId = 'pair', instant = new Date(2026, 10, 7, 10).toISOString()): DiscussionInboxRow {
  return { thread: { ...thread, id, realmId, coachClientId: realmId, anchorKey: id, derivedTitleSnapshot: 'Контекст ' + id },
    latest: { ...message(id, 'Начало последнего сообщения'), createdAt: instant }, unread: 3,
    hasAttachments: true, contact: peer(realmId, realmId === 'pair' ? 'Анна' : 'Ольга') };
}
afterEach(() => { cleanup(); state.rows = []; state.ensure.mockReset(); vi.restoreAllMocks(); });

describe('COMM-08 shared inbox surfaces', () => {
  it.each(['period', 'client'] as const)('cancels a pending conversation opening when changing the %s filter', async filter => {
    state.rows = [row('first')];
    let resolve: ((value: typeof thread) => void) | undefined;
    state.ensure.mockImplementation(() => new Promise<typeof thread>(done => { resolve = done; }));
    render(<DiscussionsPage role="coach" onNavigationContextChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Обсуждение: Анна, Контекст first' }));
    if (filter === 'period') fireEvent.click(screen.getByText('С даты'));
    else fireEvent.change(screen.getByRole('combobox'), { target: { value: 'other-pair' } });
    await act(async () => { resolve?.(state.rows[0].thread); });
    expect(screen.queryByRole('dialog')).toBeNull();
    if (filter === 'period') expect(screen.getByText('Выбрать 7 ноября')).toBeTruthy();
    else expect(screen.queryByText('Контекст first')).toBeNull();
  });

  it('keeps the primary discussion action independent from the entity action and exposes metadata', () => {
    const open = vi.fn(), entity = vi.fn();
    const first = row('first');
    render(<DiscussionInboxList rows={[first]} onOpen={open} onEntity={entity} />);
    fireEvent.click(screen.getByRole('button', { name: 'К сущности: Контекст first' }));
    expect(entity).toHaveBeenCalledWith(first); expect(open).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Обсуждение: Анна, Контекст first' }));
    expect(open).toHaveBeenCalledWith(first);
    expect(screen.getByLabelText('Непрочитанных: 3')).toBeTruthy();
    expect(screen.getByLabelText('Есть вложения')).toBeTruthy();
    expect(screen.getByText('Начало последнего сообщения').className).toContain('ellipsis');
    expect(document.querySelector('time')?.dateTime).toBe(first.latest?.createdAt);
    expect(document.querySelector('button button')).toBeNull();
  });
  it('opens the existing sheet, routes Back to the same offline list, and returns from the exact entity', async () => {
    state.rows = [row('first')]; state.ensure.mockResolvedValue(state.rows[0].thread);
    const navigation = vi.fn();
    render(<DiscussionsPage role="client" onNavigationContextChange={navigation} />);
    expect(screen.getByText('Нет соединения. Показаны обсуждения на устройстве.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Обсуждение: Анна, Контекст first' }));
    await screen.findByRole('dialog', { name: 'first' });
    expect(state.ensure).toHaveBeenCalledTimes(1);
    const context = navigation.mock.calls.at(-1)?.[0] as NavigationContext;
    expect(context.onBack).toBeTypeOf('function');
    act(() => context.onBack?.());
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'К сущности: Контекст first' }));
    expect(screen.getByText('Сущность first')).toBeTruthy();
    fireEvent.click(screen.getByText('Назад в список'));
    expect(screen.getByRole('button', { name: 'Обсуждение: Анна, Контекст first' })).toBeTruthy();
    expect(state.ensure).toHaveBeenCalledTimes(1);
  });
  it('scopes the client tab to its relationship and filters Coach by relationship and local dates', async () => {
    state.rows = [row('first'), row('other', 'other-pair'), row('yesterday', 'pair', new Date(2026, 10, 6, 23).toISOString())];
    const view = render(<DiscussionsPage role="coach" relationshipId="pair" onNavigationContextChange={vi.fn()} />);
    expect(screen.queryByText('Контекст other')).toBeNull();
    expect(screen.queryByRole('combobox')).toBeNull();
    view.unmount();
    render(<DiscussionsPage role="coach" onNavigationContextChange={vi.fn()} />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'pair' } });
    fireEvent.click(screen.getByText('С даты'));
    fireEvent.click(screen.getByText('Выбрать 7 ноября'));
    await waitFor(() => expect(screen.queryByText('Контекст yesterday')).toBeNull());
    expect(screen.queryByText('Контекст other')).toBeNull();
    expect(screen.getByText('Контекст first')).toBeTruthy();
    fireEvent.click(screen.getByText('Сбросить'));
    expect(screen.getByText('Контекст other')).toBeTruthy();
  });
  it('paginates rows without duplicates and rejects a late opening after navigating to another entity', async () => {
    state.rows = Array.from({ length: 51 }, (_, index) => row('row-' + index));
    let resolve: ((value: typeof thread) => void) | undefined;
    state.ensure.mockImplementation(() => new Promise<typeof thread>(done => { resolve = done; }));
    render(<DiscussionsPage role="client" onNavigationContextChange={vi.fn()} />);
    expect(screen.getAllByRole('listitem')).toHaveLength(50);
    fireEvent.click(screen.getByText('Показать ещё'));
    expect(screen.getAllByRole('listitem')).toHaveLength(51);
    fireEvent.click(screen.getByRole('button', { name: 'Обсуждение: Анна, Контекст row-0' }));
    fireEvent.click(screen.getByRole('button', { name: 'К сущности: Контекст row-1' }));
    resolve?.(state.rows[0].thread);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByText('Сущность row-1')).toBeTruthy();
  });
});
