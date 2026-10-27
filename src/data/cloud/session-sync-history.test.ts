import { describe, expect, it, vi } from 'vitest';
import { SessionSyncHistory, SYNC_HISTORY_LIMIT, SYNC_HISTORY_WINDOW_MS } from './session-sync-history';

function memoryStorage() {
  const items = new Map<string, string>();
  return {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => { items.set(key, value); },
    removeItem: (key: string) => { items.delete(key); },
    items,
  };
}

describe('session-local Dexie Cloud timeline', () => {
  it('captures transitions from both channels, suppresses repeated identical emissions and notifies listeners', () => {
    const storage = memoryStorage();
    let now = 100_000;
    const history = new SessionSyncHistory('tg:101', storage, () => now);
    const notify = vi.fn();
    const unsubscribe = history.subscribe(notify);
    history.recordSync('initial', 'not-started');
    history.recordWebSocket('not-started');
    now += 1000;
    history.recordSync('initial', 'not-started');
    history.recordWebSocket('not-started');
    history.recordSync('pushing', 'connecting');
    history.recordWebSocket('connected');
    history.recordSync('in-sync', 'connected');
    expect(history.getSnapshot()).toEqual([
      { at: 100_000, source: 'sync', phase: 'initial', status: 'not-started' },
      { at: 100_000, source: 'websocket', status: 'not-started' },
      { at: 101_000, source: 'sync', phase: 'pushing', status: 'connecting' },
      { at: 101_000, source: 'websocket', status: 'connected' },
      { at: 101_000, source: 'sync', phase: 'in-sync', status: 'connected' },
    ]);
    expect(notify).toHaveBeenCalledTimes(5);
    unsubscribe();
    history.recordWebSocket('disconnected');
    expect(notify).toHaveBeenCalledTimes(5);
    expect(storage.items.size).toBe(1);
  });

  it('retains only the latest hour and preserves current state after earlier identical events expire', () => {
    const storage = memoryStorage();
    let now = 5_000_000;
    const history = new SessionSyncHistory('tg:101', storage, () => now);
    history.recordSync('in-sync', 'offline');
    now += SYNC_HISTORY_WINDOW_MS + 1;
    history.recordSync('in-sync', 'offline');
    expect(history.getSnapshot()).toEqual([
      { at: now, source: 'sync', phase: 'in-sync', status: 'offline' },
    ]);
    now += SYNC_HISTORY_WINDOW_MS + 1;
    history.prune();
    expect(history.getSnapshot()).toEqual([]);
    expect(storage.items.size).toBe(0);
  });

  it('restores only this account and session, rejects invalid rows, and never stores arbitrary error bodies', () => {
    const storage = memoryStorage();
    let now = 100_000;
    const first = new SessionSyncHistory('tg:101', storage, () => now);
    first.recordSync('error', 'error');
    first.recordSync('token:private', 'error'); // not a legitimate technical phase
    first.recordWebSocket('https://secret.example'); // never store arbitrary SDK strings
    expect(first.getSnapshot()).toHaveLength(1);
    const sameAccount = new SessionSyncHistory('tg:101', storage, () => now);
    expect(sameAccount.getSnapshot()).toEqual(first.getSnapshot());
    const otherAccount = new SessionSyncHistory('tg:202', storage, () => now);
    expect(otherAccount.getSnapshot()).toEqual([]);
    otherAccount.recordWebSocket('connecting');
    expect(new SessionSyncHistory('tg:101', storage, () => now).getSnapshot()).toHaveLength(1);

    storage.setItem('mezfit:dev-sync-history:v1:tg:303', JSON.stringify([
      { at: now, source: 'sync', phase: 'in-sync', status: 'connected', token: 'ignored' },
      { at: now, source: 'sync', phase: 'secret', status: 'connected' },
    ]));
    const sanitized = new SessionSyncHistory('tg:303', storage, () => now);
    expect(sanitized.getSnapshot()).toEqual([
      { at: now, source: 'sync', phase: 'in-sync', status: 'connected', token: 'ignored' },
    ]);
    // The diagnostic view only renders documented phase/status, not extra keys from cached data.
  });

  it('bounds high-frequency event history and supports a manual clear', () => {
    let now = 100_000;
    const storage = memoryStorage();
    const history = new SessionSyncHistory('tg:101', storage, () => now);
    for (let i = 0; i < SYNC_HISTORY_LIMIT + 23; i += 1) {
      now += 10;
      history.recordWebSocket(i % 2 === 0 ? 'connecting' : 'connected');
    }
    expect(history.getSnapshot()).toHaveLength(SYNC_HISTORY_LIMIT);
    history.clear();
    expect(history.getSnapshot()).toEqual([]);
    expect(storage.items.size).toBe(0);
  });

  it('continues capturing in memory if sessionStorage is inaccessible', () => {
    let now = 100_000;
    const blocked = {
      getItem: (_key: string): string | null => { throw Error('denied'); },
      setItem: (_key: string, _value: string): void => { throw Error('denied'); },
      removeItem: (_key: string): void => { throw Error('denied'); },
    };
    const history = new SessionSyncHistory('tg:101', blocked, () => now);
    history.recordSync('initial', 'connecting');
    now += 1;
    history.recordWebSocket('connected');
    expect(history.getSnapshot()).toHaveLength(2);
    history.clear();
    expect(history.getSnapshot()).toEqual([]);
  });
});
