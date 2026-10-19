// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ContactAvatarUrls } from '../data/cloud/contact-avatar-urls';
import { CloudContactAvatar } from './CloudContactAvatar';

let cache: ContactAvatarUrls | undefined;
const loadAvatar = vi.fn(async () => new Blob(['portrait'], { type: 'image/jpeg' }));
vi.mock('../data/cloud/CloudConnectionsProvider', () => ({
  useCloudConnections: () => ({ loadAvatar, avatarUrls: cache }),
}));

const peer = {
  relationshipId: 'rlm' + 'a'.repeat(28),
  userId: 'tg:202',
  telegramUserId: '202',
  displayName: 'Анна Иванова',
  avatarVersion: 'b'.repeat(64),
};

beforeEach(() => {
  cache = undefined;
  vi.clearAllMocks();
  const NativeURL = URL;
  vi.stubGlobal('URL', class extends NativeURL {
    static createObjectURL = vi.fn(() => 'blob:mezfit-portrait');
    static revokeObjectURL = vi.fn();
  });
});

afterEach(() => {
  cleanup();
  cache?.dispose();
  vi.unstubAllGlobals();
});

describe('CloudContactAvatar', () => {
  it('reuses the same loaded image immediately when calendar pages unmount and reopen', async () => {
    cache = new ContactAvatarUrls();
    const first = render(<CloudContactAvatar contact={peer} />);
    await waitFor(() => expect(document.querySelector('img.ui-avatar')?.getAttribute('src')).toBe('blob:mezfit-portrait'));
    first.unmount();
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    const second = render(<CloudContactAvatar contact={{ ...peer }} />);
    expect(document.querySelector('img.ui-avatar')?.getAttribute('src')).toBe('blob:mezfit-portrait');
    second.rerender(<CloudContactAvatar contact={{ ...peer, displayName: 'Новое имя' }} />);
    expect(document.querySelector('img.ui-avatar')?.getAttribute('src')).toBe('blob:mezfit-portrait');
    await waitFor(() => expect(loadAvatar).toHaveBeenCalledTimes(1));
    cache.dispose();
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1);
  });

  it('uses the existing UIkit fallback, then the cached binary image', async () => {
    const view = render(<CloudContactAvatar contact={peer} />);
    expect(screen.getByRole('img', { name: 'Анна Иванова' }).textContent).toBe('АИ');
    await waitFor(() => expect(document.querySelector('img.ui-avatar')?.getAttribute('src')).toBe('blob:mezfit-portrait'));
    expect(loadAvatar).toHaveBeenCalledTimes(1);
    view.unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:mezfit-portrait');
  });

  it('keeps initials if no Telegram photo is available', () => {
    render(<CloudContactAvatar contact={{ ...peer, avatarVersion: null }} />);
    expect(screen.getByRole('img', { name: 'Анна Иванова' })).toBeTruthy();
    expect(loadAvatar).not.toHaveBeenCalled();
  });
});
