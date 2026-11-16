// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import type { MezfitCloudDatabase } from './database';
import { DiscussionSync } from './discussion-sync';

type State = MezfitCloudDatabase['cloud']['syncState']['value'];
function fixture() {
  let snapshot = { phase: 'initial', status: 'offline' } as State;
  const watchers = new Set<(value: State) => void>();
  const cloud = {
    sync: vi.fn(async () => undefined),
    syncState: {
      get value() { return snapshot; },
      subscribe({ next }: { next: (state: State) => void }) {
        watchers.add(next); next(snapshot);
        return { unsubscribe: () => { watchers.delete(next); } };
      },
    },
  };
  const db = { cloud } as unknown as Pick<MezfitCloudDatabase, 'cloud'>;
  return { db, sync: new DiscussionSync(db),
    phase(phase: State['phase'], status: State['status']) {
      snapshot = { phase, status } as State;
      for (const next of watchers) next(snapshot);
    },
  };
}
describe('discussion sync acknowledgements, independent from local acceptance', () => {
  it('requires an in-sync phase before the global status turns green', async () => {
    const { db, sync, phase } = fixture();
    let release: () => void = () => {};
    const push = vi.spyOn(db.cloud, 'sync').mockImplementation(() => new Promise<void>(resolve => { release = resolve; }));
    sync.changed(); const pending = sync.retry(); sync.changed();
    expect(sync.state().status).toBe('local'); release(); await pending;
    expect(sync.state().status).toBe('local');
    push.mockResolvedValue(undefined); await sync.retry();
    expect(sync.state().status).toBe('local');
    phase('in-sync', 'offline');
    expect(sync.state().status).toBe('synced');
    expect(push).toHaveBeenLastCalledWith({ purpose: 'push', wait: true });
  });
  it('keeps explicit push errors retryable and ignores stale failures', async () => {
    const { db, sync, phase } = fixture();
    const push = vi.spyOn(db.cloud, 'sync').mockRejectedValue(new Error('unreachable'));
    sync.changed(); await expect(sync.retry()).rejects.toThrow('DISCUSSION_SYNC_FAILED');
    expect(sync.state().status).toBe('error');
    let rejectOld: (reason: unknown) => void = () => {};
    push.mockImplementationOnce(() => new Promise<void>((_, reject) => { rejectOld = reject; }))
      .mockResolvedValue(undefined);
    const old = sync.retry(); const oldResult = expect(old).rejects.toThrow('DISCUSSION_SYNC_FAILED');
    await sync.retry(); rejectOld(new Error('old failure')); await oldResult;
    phase('in-sync', 'offline');
    expect(sync.state().status).toBe('synced');
    const listener = vi.fn(); const sub = sync.observe(listener);
    sub.unsubscribe(); listener.mockClear();
    sync.changed(); expect(listener).not.toHaveBeenCalled();
  });
  it('keeps a thread local until its latest revision is acknowledged even during in-sync / offline', async () => {
    const { db, sync, phase } = fixture();
    phase('in-sync', 'offline');
    sync.changed();
    expect(sync.state().status).toBe('local');
    let release: () => void = () => {};
    vi.spyOn(db.cloud, 'sync').mockImplementation(() => new Promise<void>(resolve => { release = resolve; }));
    const push = sync.retry();
    expect(sync.state().status).toBe('local');
    release(); await push;
    expect(sync.state().status).toBe('synced');
    sync.changed();
    expect(sync.state().status).toBe('local');
  });
  it('requests confirmation even if Dexie reports in-sync / offline', async () => {
    const { db, sync, phase } = fixture();
    const push = vi.spyOn(db.cloud, 'sync').mockResolvedValue(undefined);
    const listener = vi.fn(), sub = sync.observe(listener);
    sync.changed(); phase('pushing', 'offline');
    expect(sync.state().status).toBe('syncing');
    phase('in-sync', 'offline');
    await vi.waitFor(() => expect(push).toHaveBeenCalledWith({ purpose: 'push', wait: true }));
    expect(sync.state().status).toBe('synced');
    sub.unsubscribe();
  });
});
