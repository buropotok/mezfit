// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { liveQuery } from 'dexie';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getMe } from '../api';
import { loadContactAvatar } from '../data/cloud/contact-avatar-cache';
import { createCloudDatabase, type MezfitCloudDatabase } from '../data/cloud/database';
import { CloudAvatarDiagnostic } from './CloudAvatarDiagnostic';
import { CloudAuthDiagnostic } from './CloudAuthDiagnostic';

vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api')>();
  return { ...actual, getMe: vi.fn() };
});
vi.mock('../data/cloud/database', () => ({ createCloudDatabase: vi.fn() }));
vi.mock('../data/cloud/contact-avatar-cache', () => ({ loadContactAvatar: vi.fn() }));
vi.mock('dexie', async (importOriginal) => {
  const actual = await importOriginal<typeof import('dexie')>();
  return { ...actual, liveQuery: vi.fn() };
});

const unsubscribe = vi.fn();
const open = vi.fn(async () => undefined);
const close = vi.fn();
const sync = vi.fn(async () => undefined);
const db = {
  open, close,
  realms: { toArray: vi.fn(async () => []) },
  members: { toArray: vi.fn(async () => []) },
  contactProfiles: { toArray: vi.fn(async () => []) },
  cloud: { sync },
} as unknown as MezfitCloudDatabase;
const peer = {
  userId: 'tg:202',
  relationshipId: 'rlm' + 'a'.repeat(28),
  telegramUserId: '202',
  displayName: 'Пользователь',
  avatarVersion: 'f'.repeat(64),
};

let visibleContacts = [peer];

beforeEach(() => {
  vi.clearAllMocks();
  visibleContacts = [peer];
  vi.mocked(getMe).mockResolvedValue({
    user: { telegramUserId: '101' },
  } as Awaited<ReturnType<typeof getMe>>);
  vi.mocked(createCloudDatabase).mockReturnValue(db);
  vi.mocked(liveQuery).mockReturnValue({
    subscribe: (observer: { next: (contacts: typeof peer[]) => void }) => {
      observer.next(visibleContacts);
      return { unsubscribe };
    },
  } as unknown as ReturnType<typeof liveQuery>);

  const NativeURL = URL;
  vi.stubGlobal('URL', class extends NativeURL {
    static createObjectURL = vi.fn(() => 'blob:safe-diagnostic');
    static revokeObjectURL = vi.fn();
  });
  vi.stubGlobal('Image', class {
    onload?: () => void;
    onerror?: () => void;
    set src(_value: string) {
      queueMicrotask(() => this.onload?.());
    }
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  delete window.Telegram;
});

describe('on-demand cloud avatar diagnostic', () => {
  it('reports a successful Worker response followed by local IndexedDB failure without leaking identifiers', async () => {
    vi.mocked(loadContactAvatar).mockImplementation(async (_account, _initData, _peer, trace) => {
      trace?.('requesting-worker');
      trace?.('http-accepted');
      trace?.('mime-accepted');
      trace?.('blob-validated');
      trace?.('indexeddb-writing');
      trace?.('indexeddb-error');
      return null;
    });
    render(<CloudAvatarDiagnostic initData="secret-signed-telegram-initdata" />);
    await waitFor(() => expect(screen.getByText('С версией аватара: 1')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Проверить загрузку аватара' }));
    await waitFor(() => expect(screen.getByText('Результат: ошибка')).toBeTruthy());
    expect(screen.getByText('Worker: HTTP 200')).toBeTruthy();
    expect(screen.getByText('Blob прочитан и проверен')).toBeTruthy();
    expect(screen.getAllByText('Ошибка чтения или записи IndexedDB').length).toBeGreaterThan(0);
    expect(loadContactAvatar).toHaveBeenCalledWith(
      '101', 'secret-signed-telegram-initdata', peer, expect.any(Function),
    );
    const output = document.body.textContent ?? '';
    for (const secret of [
      'secret-signed-telegram-initdata', 'tg:202', peer.relationshipId, peer.avatarVersion,
    ]) expect(output).not.toContain(secret);
  });

  it('decodes a returned Blob and passes its object URL to unchanged UIkit Avatar', async () => {
    vi.mocked(loadContactAvatar).mockImplementation(async (_account, _initData, _peer, trace) => {
      trace?.('cache-hit');
      return new Blob(['file content'], { type: 'image/jpeg' });
    });
    const view = render(<CloudAvatarDiagnostic initData="signed" />);
    await waitFor(() => expect(screen.getByText('С версией аватара: 1')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Проверить загрузку аватара' }));
    await waitFor(() => expect(screen.getByText('Результат: успешно')).toBeTruthy());
    expect(document.querySelector('img.ui-avatar')?.getAttribute('src')).toBe('blob:safe-diagnostic');
    view.unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:safe-diagnostic');
  });

  it('does not attempt downloads if synced contacts lack avatar metadata', async () => {
    visibleContacts = [{ ...peer, avatarVersion: null }] as typeof peer[];
    render(<CloudAvatarDiagnostic initData="signed" />);
    await waitFor(() => expect(screen.getByText('С версией аватара: 0')).toBeTruthy());
    expect(screen.getByRole('button', { name: 'Проверить загрузку аватара' }).hasAttribute('disabled')).toBe(true);
    expect(loadContactAvatar).not.toHaveBeenCalled();
  });

  it('appears only after explicit toggle on the existing Telegram diagnostic surface', async () => {
    window.Telegram = { WebApp: {
      initData: 'signed',
      colorScheme: 'dark',
      ready: vi.fn(), expand: vi.fn(),
    } };
    render(<CloudAuthDiagnostic />);
    expect(createCloudDatabase).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Проверить аватары' }));
    await waitFor(() => expect(screen.getByText('С версией аватара: 1')).toBeTruthy());
    expect(createCloudDatabase).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'Скрыть диагностику аватаров' }));
    expect(close).toHaveBeenCalledWith({ disableAutoOpen: false });
  });
});
