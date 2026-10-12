// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchCloudContactAvatar } from '../../api';
import { loadContactAvatar } from './contact-avatar-cache';

const files = new Map<string, Map<string, { version: string; blob: Blob }>>();
vi.mock('dexie', () => ({
  default: class {
    files: {
      get: (key: string) => Promise.resolve(files.get(this.name)?.get(key)),
      put: (row: { userId: string; version: string; blob: Blob }) => {
        const entries = files.get(this.name) ?? new Map();
        entries.set(row.userId, row);
        files.set(this.name, entries);
        return Promise.resolve(row.userId);
      },
    };
    constructor(private readonly name: string) {}
    version() { return { stores: () => undefined }; }
    close() {}
  },
}));
vi.mock('../../api', () => ({ fetchCloudContactAvatar: vi.fn() }));

const contact = {
  relationshipId: 'rlm' + 'a'.repeat(28),
  userId: 'tg:202',
  avatarVersion: 'b'.repeat(64),
};

beforeEach(() => {
  vi.clearAllMocks();
  files.clear();
  vi.mocked(fetchCloudContactAvatar).mockResolvedValue(new Blob(['valid-image'], { type: 'image/jpeg' }));
});

describe('local-first contact avatar cache', () => {
  it('downloads once and reuses immutable bytes without another request or write', async () => {
    const first = await loadContactAvatar('101', 'signed', contact);
    const second = await loadContactAvatar('101', 'signed', contact);
    expect(first).toBeInstanceOf(Blob);
    expect(second).toBeInstanceOf(Blob);
    expect(fetchCloudContactAvatar).toHaveBeenCalledTimes(1);
    expect(files.get('mezfit-avatar-cache:101')?.size).toBe(1);
  });

  it('replaces bytes only if cloud avatar version changes', async () => {
    await loadContactAvatar('101', 'signed', contact);
    await loadContactAvatar('101', 'signed', { ...contact, avatarVersion: 'c'.repeat(64) });
    expect(fetchCloudContactAvatar).toHaveBeenCalledTimes(2);
    expect(files.get('mezfit-avatar-cache:101')?.get('tg:202')?.version).toBe('c'.repeat(64));
  });

  it('isolates media between Telegram accounts and refuses malformed remote references', async () => {
    await loadContactAvatar('101', 'signed-one', contact);
    await loadContactAvatar('303', 'signed-two', contact);
    expect(fetchCloudContactAvatar).toHaveBeenCalledTimes(2);
    expect(files.size).toBe(2);
    expect(await loadContactAvatar('101', 'signed', { ...contact, avatarVersion: null })).toBeNull();
    expect(await loadContactAvatar('101', 'signed', { ...contact, relationshipId: 'invalid' })).toBeNull();
    expect(fetchCloudContactAvatar).toHaveBeenCalledTimes(2);
  });

  it('falls back safely when the protected photo is not yet available', async () => {
    vi.mocked(fetchCloudContactAvatar).mockRejectedValueOnce(new Error('OFFLINE'));
    expect(await loadContactAvatar('101', 'signed', contact)).toBeNull();
    expect(await loadContactAvatar('101', 'signed', contact)).toBeInstanceOf(Blob);
    expect(fetchCloudContactAvatar).toHaveBeenCalledTimes(2);
  });
});
