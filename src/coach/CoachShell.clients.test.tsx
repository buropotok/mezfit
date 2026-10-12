// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CoachShell } from './CoachShell';

vi.mock('../schedule/TodayPage', () => ({
  TodayPage: () => <div>Coach Today</div>,
}));

const cloudConnections = {
  status: 'ready',
  error: '',
  clients: [
    { relationshipId: 'rlm4', userId: 'tg:104', telegramUserId: '104', displayName: '李' },
    { relationshipId: 'rlm3', userId: 'tg:103', telegramUserId: '103', displayName: 'Борис Петров' },
    { relationshipId: 'rlm2', userId: 'tg:102', telegramUserId: '102', displayName: 'Анна Иванова' },
    { relationshipId: 'rlm1', userId: 'tg:101', telegramUserId: '101', displayName: 'Андрей Соколов' },
  ],
  refresh: vi.fn(async () => undefined),
};

vi.mock('../data/cloud/CloudConnectionsProvider', () => ({
  useCloudConnections: () => cloudConnections,
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('CoachShell client contacts', () => {
  it('groups synced cloud clients alphabetically and keeps named rows selectable', async () => {
    vi.stubGlobal('ResizeObserver', class {
      observe() {}
      unobserve() {}
      disconnect() {}
    });
    const onNavigationContextChange = vi.fn();

    render(
      <CoachShell
        initData="telegram-init"
        destination="clients"
        onNavigationContextChange={onNavigationContextChange}
      />,
    );

    const andrei = await screen.findByRole('button', { name: 'Открыть клиента Андрей Соколов' });
    const anna = screen.getByRole('button', { name: 'Открыть клиента Анна Иванова' });
    const boris = screen.getByRole('button', { name: 'Открыть клиента Борис Петров' });
    const li = screen.getByRole('button', { name: 'Открыть клиента 李' });
    const groupA = screen.getByText('А', { selector: 'li' });
    const groupB = screen.getByText('Б', { selector: 'li' });
    const groupLi = screen.getByText('李', { selector: 'li' });

    expect(screen.queryByText('@sokolag')).toBeNull();
    expect(document.querySelector('img[src="https://example.com/andrei.jpg"]')).toBeNull();
    expect(groupA.compareDocumentPosition(andrei) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(andrei.compareDocumentPosition(anna) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(anna.compareDocumentPosition(groupB) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(groupB.compareDocumentPosition(boris) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(groupLi.compareDocumentPosition(li) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByText('#', { selector: 'li' })).toBeNull();

    fireEvent.click(andrei);
    await waitFor(() => expect(onNavigationContextChange).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Андрей Соколов',
    })));
  });
});


describe('CoachShell Today loading', () => {
  it('does not issue a legacy D1 client-directory fetch from the Today screen', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    render(
      <CoachShell
        initData="telegram-init"
        destination="today"
        onNavigationContextChange={vi.fn()}
      />,
    );

    expect(await screen.findByText('Coach Today')).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
