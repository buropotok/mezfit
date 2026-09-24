// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CoachShell } from './CoachShell';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('CoachShell client contacts', () => {
  it('groups clients alphabetically and keeps avatar/name/Telegram username rows selectable', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/coach/clients') {
        return new Response(JSON.stringify({
          clients: [
            {
              relationshipId: 3,
              user: {
                id: 103,
                telegramUserId: '103',
                username: 'boris',
                firstName: 'Борис',
                lastName: 'Петров',
                languageCode: 'ru',
                photoUrl: null,
                isPremium: false,
              },
            },
            {
              relationshipId: 2,
              user: {
                id: 102,
                telegramUserId: '102',
                username: 'anna',
                firstName: 'Анна',
                lastName: 'Иванова',
                languageCode: 'ru',
                photoUrl: null,
                isPremium: false,
              },
            },
            {
              relationshipId: 1,
              user: {
                id: 101,
                telegramUserId: '101',
                username: 'sokolag',
                firstName: 'Андрей',
                lastName: 'Соколов',
                languageCode: 'ru',
                photoUrl: 'https://example.com/andrei.jpg',
                isPremium: false,
              },
            },
          ],
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
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
    const groupA = screen.getByText('А', { selector: 'li' });
    const groupB = screen.getByText('Б', { selector: 'li' });

    expect(screen.getByText('@sokolag')).toBeTruthy();
    expect(document.querySelector('img[src="https://example.com/andrei.jpg"]')).not.toBeNull();
    expect(groupA.compareDocumentPosition(andrei) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(andrei.compareDocumentPosition(anna) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(anna.compareDocumentPosition(groupB) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(groupB.compareDocumentPosition(boris) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    fireEvent.click(andrei);
    await waitFor(() => expect(onNavigationContextChange).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Андрей Соколов',
    })));
  });
});
