// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { liveQuery } from 'dexie';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { diagnoseCloudContactProfileSync, getMe, inspectTelegramAvatarSource } from '../api';
import { loadContactAvatar } from '../data/cloud/contact-avatar-cache';
import { createCloudDatabase, type MezfitCloudDatabase } from '../data/cloud/database';
import type { CloudContact } from '../data/cloud/CloudConnectionsProvider';
import { CloudAvatarDiagnostic } from './CloudAvatarDiagnostic';
import { CloudAuthDiagnostic } from './CloudAuthDiagnostic';

vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api')>();
  return { ...actual, getMe: vi.fn(), diagnoseCloudContactProfileSync: vi.fn(), inspectTelegramAvatarSource: vi.fn() };
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

let visibleContacts: CloudContact[] = [peer];

beforeEach(() => {
  vi.clearAllMocks();
  visibleContacts = [peer];
  vi.mocked(diagnoseCloudContactProfileSync).mockResolvedValue({ changed: false, avatarStatus: 'unchanged' });
  vi.mocked(inspectTelegramAvatarSource).mockResolvedValue({ comparison: 'same', image: new Blob([new Uint8Array(36)], { type: 'image/jpeg' }) });
  vi.mocked(getMe).mockResolvedValue({
    user: { telegramUserId: '101' },
  } as Awaited<ReturnType<typeof getMe>>);
  vi.mocked(createCloudDatabase).mockReturnValue(db);
  vi.mocked(liveQuery).mockReturnValue({
    subscribe: (observer: { next: (contacts: CloudContact[]) => void }) => {
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
  it('reports a missing local Dexie avatar without leaking identifiers', async () => {
    vi.mocked(loadContactAvatar).mockImplementation(async (_db, _peer, trace) => {
      trace?.('reading-dexie');
      trace?.('profile-not-found');
      return null;
    });
    render(<CloudAvatarDiagnostic initData="secret-signed-telegram-initdata" />);
    await waitFor(() => expect(screen.getByText('С версией аватара: 1')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Проверить загрузку аватара' }));
    await waitFor(() => expect(screen.getByText('Результат: ошибка')).toBeTruthy());
    expect(screen.getAllByText('В синхронизированном профиле нет фотографии').length).toBeGreaterThan(0);
    expect(loadContactAvatar).toHaveBeenCalledWith(
      db, peer, expect.any(Function),
    );
    const output = document.body.textContent ?? '';
    for (const secret of [
      'secret-signed-telegram-initdata', 'tg:202', peer.relationshipId, peer.avatarVersion,
    ]) expect(output).not.toContain(secret);
  });

  it('decodes a returned Blob and passes its object URL to unchanged UIkit Avatar', async () => {
    vi.mocked(loadContactAvatar).mockImplementation(async (_db, _peer, trace) => {
      trace?.('blob-validated');
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
    visibleContacts = [{ ...peer, avatarVersion: null }];
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

  it('shows a safe stage when a new Telegram photo cannot be uploaded to Dexie Cloud', async () => {
    vi.mocked(diagnoseCloudContactProfileSync).mockResolvedValue({
      changed: false, avatarStatus: 'upload-failed',
    });
    render(<CloudAvatarDiagnostic initData="signed" />);
    await waitFor(() => expect(screen.getByText('С версией аватара: 1')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Проверить обновление моего Telegram-аватара' }));
    await waitFor(() => expect(screen.getByText('Не удалось записать новую фотографию в Dexie Cloud')).toBeTruthy());
    expect(diagnoseCloudContactProfileSync).toHaveBeenCalledWith('signed');
    expect(document.body.textContent).not.toContain('tg:202');
  });

  it('shows the Bot API JPEG even when its version matches the cloud, without printing identifiers', async () => {
    const view = render(<CloudAvatarDiagnostic initData="signed-secret" />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Посмотреть фото, которое Telegram отдаёт Mezfit' }).hasAttribute('disabled')).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: 'Посмотреть фото, которое Telegram отдаёт Mezfit' }));
    await waitFor(() => expect(screen.getByText(/Версия фотографии из Telegram совпадает с Dexie Cloud/)).toBeTruthy());
    const image = screen.getByAltText('Фотография, которую Telegram Bot API возвращает приложению');
    expect(image.getAttribute('src')).toBe('blob:safe-diagnostic');
    expect(image.getAttribute('width')).toBe('256');
    expect(inspectTelegramAvatarSource).toHaveBeenCalledWith('signed-secret', expect.any(AbortSignal));
    expect(diagnoseCloudContactProfileSync).not.toHaveBeenCalled();
    const text = document.body.textContent ?? '';
    for (const secret of ['signed-secret', 'tg:202', peer.relationshipId, peer.avatarVersion]) {
      expect(text).not.toContain(secret);
    }
    view.unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:safe-diagnostic');
  });

  it('reports photo version mismatch or missing photo without writing shared data', async () => {
    vi.mocked(inspectTelegramAvatarSource)
      .mockResolvedValueOnce({ comparison: 'different', image: new Blob([new Uint8Array(36)], { type: 'image/jpeg' }) })
      .mockResolvedValueOnce({ comparison: 'no-photo', image: null });
    render(<CloudAvatarDiagnostic initData="signed" />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Посмотреть фото, которое Telegram отдаёт Mezfit' }).hasAttribute('disabled')).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: 'Посмотреть фото, которое Telegram отдаёт Mezfit' }));
    await waitFor(() => expect(screen.getByText(/Telegram вернул версию, которой нет в сохранённом профиле/)).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Посмотреть фото, которое Telegram отдаёт Mezfit' }));
    await waitFor(() => expect(screen.getByText('Bot API сообщает, что доступной фотографии нет.')).toBeTruthy());
    expect(screen.queryByAltText('Фотография, которую Telegram Bot API возвращает приложению')).toBeNull();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:safe-diagnostic');
    expect(diagnoseCloudContactProfileSync).not.toHaveBeenCalled();
  });

  it('does not display a broken preview or sensitive error details after source read failure', async () => {
    vi.mocked(inspectTelegramAvatarSource).mockRejectedValueOnce(new Error('secret-file-id-should-not-leak'));
    render(<CloudAvatarDiagnostic initData="signed" />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Посмотреть фото, которое Telegram отдаёт Mezfit' }).hasAttribute('disabled')).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: 'Посмотреть фото, которое Telegram отдаёт Mezfit' }));
    await waitFor(() => expect(screen.getByText('Не удалось проверить изображение Telegram. Данные не изменены.')).toBeTruthy());
    expect(document.body.textContent).not.toContain('secret-file-id-should-not-leak');
    expect(screen.queryByAltText('Фотография, которую Telegram Bot API возвращает приложению')).toBeNull();
  });
});
