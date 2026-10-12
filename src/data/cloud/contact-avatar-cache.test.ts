// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchCloudContactAvatar } from '../../api';
import { loadContactAvatar, pruneUnlinkedContactAvatars } from './contact-avatar-cache';

const files = new Map<string, Map<string, { userId: string; version: string; blob: Blob }>>();
const allowed = new Map<string, Map<string, { userId: string; version: string | null }>>();

vi.mock('dexie', () => ({
  default: class {
    files = {
      get: (key: string) => Promise.resolve(files.get(this.name)?.get(key)),
      toArray: () => Promise.resolve(Array.from(files.get(this.name)?.values() ?? [])),
      delete: (key: string) => Promise.resolve(files.get(this.name)?.delete(key)),
      put: (row: { userId: string; version: string; blob: Blob }) => {
        const entries = files.get(this.name) ?? new Map();
        entries.set(row.userId, row);
        files.set(this.name, entries);
        return Promise.resolve(row.userId);
      },
    };
    allowed = {
      get: (key: string) => Promise.resolve(allowed.get(this.name)?.get(key)),
      toArray: () => Promise.resolve(Array.from(allowed.get(this.name)?.values() ?? [])),
      delete: (key: string) => Promise.resolve(allowed.get(this.name)?.delete(key)),
      put: (row: { userId: string; version: string | null }) => {
        const entries = allowed.get(this.name) ?? new Map();
        entries.set(row.userId, row);
        allowed.set(this.name, entries);
        return Promise.resolve(row.userId);
      },
    };
    constructor(private readonly name: string) {}
    version() { return { stores: () => undefined }; }
    transaction(_mode: string, ...args: unknown[]) {
      const action = args[args.length - 1] as () => Promise<unknown>;
      return action();
    }
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
  allowed.clear();
  vi.mocked(fetchCloudContactAvatar).mockResolvedValue(new Blob(['valid-image'], { type: 'image/jpeg' }));
});

describe('local-first contact avatar cache', () => {
  it('downloads once and reuses immutable bytes without another request or write', async () => {
    await pruneUnlinkedContactAvatars('101', [contact]);
    const first = await loadContactAvatar('101', 'signed', contact);
    const second = await loadContactAvatar('101', 'signed', contact);
    expect(first).toBeInstanceOf(Blob);
    expect(second).toBeInstanceOf(Blob);
    expect(fetchCloudContactAvatar).toHaveBeenCalledTimes(1);
    expect(files.get('mezfit-avatar-cache:101')?.size).toBe(1);
  });

  it('replaces bytes only if cloud avatar version changes', async () => {
    await pruneUnlinkedContactAvatars('101', [contact]);
    await loadContactAvatar('101', 'signed', contact);
    const replacement = { ...contact, avatarVersion: 'c'.repeat(64) };
    await pruneUnlinkedContactAvatars('101', [replacement]);
    await loadContactAvatar('101', 'signed', replacement);
    expect(fetchCloudContactAvatar).toHaveBeenCalledTimes(2);
    expect(files.get('mezfit-avatar-cache:101')?.get('tg:202')?.version).toBe('c'.repeat(64));
  });

  it('isolates media between Telegram accounts and refuses malformed remote references', async () => {
    await pruneUnlinkedContactAvatars('101', [contact]);
    await pruneUnlinkedContactAvatars('303', [contact]);
    await loadContactAvatar('101', 'signed-one', contact);
    await loadContactAvatar('303', 'signed-two', contact);
    expect(fetchCloudContactAvatar).toHaveBeenCalledTimes(2);
    expect(files.size).toBe(2);
    expect(await loadContactAvatar('101', 'signed', { ...contact, avatarVersion: null })).toBeNull();
    expect(await loadContactAvatar('101', 'signed', { ...contact, relationshipId: 'invalid' })).toBeNull();
    expect(fetchCloudContactAvatar).toHaveBeenCalledTimes(2);
  });

  it('evicts revoked and outdated portraits only after the caller confirms cloud access', async () => {
    const other = { ...contact, userId: 'tg:303' };
    await pruneUnlinkedContactAvatars('101', [contact, other]);
    await loadContactAvatar('101', 'signed', contact);
    await loadContactAvatar('101', 'signed', other);
    expect(files.get('mezfit-avatar-cache:101')?.size).toBe(2);
    await pruneUnlinkedContactAvatars('101', [contact]);
    expect(files.get('mezfit-avatar-cache:101')?.size).toBe(1);
    expect(files.get('mezfit-avatar-cache:101')?.has('tg:202')).toBe(true);
    await pruneUnlinkedContactAvatars('101', [{ ...contact, avatarVersion: 'c'.repeat(64) }]);
    expect(files.get('mezfit-avatar-cache:101')?.size).toBe(0);
  });

  it('never restores an avatar after access is revoked during an in-flight download', async () => {
    await pruneUnlinkedContactAvatars('101', [contact]);
    let resolveDownload: ((image: Blob) => void) | undefined;
    vi.mocked(fetchCloudContactAvatar).mockImplementationOnce(() => new Promise((resolve) => {
      resolveDownload = resolve;
    }));
    const pending = loadContactAvatar('101', 'signed', contact);
    await vi.waitFor(() => expect(fetchCloudContactAvatar).toHaveBeenCalledTimes(1));
    await pruneUnlinkedContactAvatars('101', []);
    resolveDownload?.(new Blob(['old-photo']));
    expect(await pending).toBeNull();
    expect(files.get('mezfit-avatar-cache:101')?.size ?? 0).toBe(0);
    expect(allowed.get('mezfit-avatar-cache:101')?.size ?? 0).toBe(0);
  });

  it('rejects a late old-version download after a newer version was cached', async () => {
    await pruneUnlinkedContactAvatars('101', [contact]);
    let resolveOld: ((image: Blob) => void) | undefined;
    vi.mocked(fetchCloudContactAvatar).mockImplementationOnce(() => new Promise((resolve) => {
      resolveOld = resolve;
    }));
    const outdated = loadContactAvatar('101', 'signed', contact);
    await vi.waitFor(() => expect(fetchCloudContactAvatar).toHaveBeenCalledTimes(1));

    const replacement = { ...contact, avatarVersion: 'c'.repeat(64) };
    await pruneUnlinkedContactAvatars('101', [replacement]);
    await loadContactAvatar('101', 'signed', replacement);
    resolveOld?.(new Blob(['old-photo']));
    expect(await outdated).toBeNull();
    expect(files.get('mezfit-avatar-cache:101')?.get('tg:202')?.version).toBe('c'.repeat(64));
  });

  it('falls back safely when the protected photo is not yet available', async () => {
    await pruneUnlinkedContactAvatars('101', [contact]);
    vi.mocked(fetchCloudContactAvatar).mockRejectedValueOnce(new Error('OFFLINE'));
    expect(await loadContactAvatar('101', 'signed', contact)).toBeNull();
    expect(await loadContactAvatar('101', 'signed', contact)).toBeInstanceOf(Blob);
    expect(fetchCloudContactAvatar).toHaveBeenCalledTimes(2);
  });
});
