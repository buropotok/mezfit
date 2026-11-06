// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import dexieCloud from 'dexie-cloud-addon';
import { describe, expect, it, vi } from 'vitest';
import { DiscussionSync } from './discussion-sync';
function fixture() {
  const db = new Dexie('discussion-sync-' + crypto.randomUUID(), { addons: [dexieCloud] });
  return { db, sync: new DiscussionSync(db) };
}
describe('discussion sync acknowledgements, independent from local acceptance', () => {
  it('acknowledges the captured revision and preserves edits committed during push', async () => {
    const { db, sync } = fixture();
    let release: () => void = () => {};
    const push = vi.spyOn(db.cloud, 'sync').mockImplementation(() => new Promise<void>(resolve => { release = resolve; }));
    sync.changed(); const pending = sync.retry(); sync.changed();
    expect(sync.state().status).toBe('local'); release(); await pending;
    expect(sync.state().status).toBe('local');
    push.mockResolvedValue(undefined); await sync.retry();
    expect(sync.state().status).toBe('synced');
    expect(push).toHaveBeenLastCalledWith({ purpose: 'push', wait: true });
    push.mockRestore(); db.close();
  });
  it('keeps errors retryable and ignores a stale failure after a newer successful push', async () => {
    const { db, sync } = fixture();
    const push = vi.spyOn(db.cloud, 'sync').mockRejectedValue(new Error('offline'));
    sync.changed(); await expect(sync.retry()).rejects.toThrow('DISCUSSION_SYNC_FAILED');
    expect(sync.state().status).toBe('error');
    let rejectOld: (reason: unknown) => void = () => {};
    push.mockImplementationOnce(() => new Promise<void>((_, reject) => { rejectOld = reject; })).mockResolvedValue(undefined);
    const old = sync.retry(); const oldResult = expect(old).rejects.toThrow('DISCUSSION_SYNC_FAILED');
    await sync.retry(); rejectOld(new Error('old failure')); await oldResult;
    expect(sync.state().status).toBe('synced');
    const listener = vi.fn(); const sub = sync.observe(listener); sub.unsubscribe(); listener.mockClear();
    sync.changed(); expect(listener).not.toHaveBeenCalled();
    push.mockRestore(); db.close();
  });
});
