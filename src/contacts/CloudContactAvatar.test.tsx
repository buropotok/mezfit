// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CloudContactAvatar } from './CloudContactAvatar';

const loadAvatar = vi.fn(async () => new Blob(['portrait'], { type: 'image/jpeg' }));
vi.mock('../data/cloud/CloudConnectionsProvider', () => ({
  useCloudConnections: () => ({ loadAvatar }),
}));

const peer = {
  relationshipId: 'rlm' + 'a'.repeat(28),
  userId: 'tg:202',
  telegramUserId: '202',
  displayName: 'Анна Иванова',
  avatarVersion: 'b'.repeat(64),
};

beforeEach(() => {
  vi.clearAllMocks();
  const NativeURL = URL;
  vi.stubGlobal('URL', class extends NativeURL {
    static createObjectURL = vi.fn(() => 'blob:mezfit-portrait');
    static revokeObjectURL = vi.fn();
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('CloudContactAvatar', () => {
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
