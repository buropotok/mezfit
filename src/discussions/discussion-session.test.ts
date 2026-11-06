import { describe, expect, it, vi } from 'vitest';
import { DiscussionSession } from './discussion-session';
import { anchor, fixture, message } from './discussion-fixture.test-support';

describe('discussion page session uses the existing repository', () => {
  it('does not leave a gap when new messages arrive before an older page first resolves', async () => {
    const rows = Array.from({ length: 85 }, (_, index) => message('m' + index, 'Текст ' + index, 'tg:2', index));
    const f = fixture(rows), session = new DiscussionSession(f.port, { threadId: 'thread', anchor });
    session.start(); await vi.waitFor(() => expect(session.snapshot().loading).toBe(false));
    session.loadMore();
    f.replace([...rows, message('m85', 'Новое', 'tg:2', 85)]);
    await vi.waitFor(() => expect(session.snapshot().loading).toBe(false));
    expect(session.snapshot().messages).toHaveLength(80);
    expect(session.snapshot().messages[0].id).toBe('m6');
    expect(session.snapshot().messages.some(row => row.id === 'm45')).toBe(true);
    session.stop();
  });
  it('loads an older exact target, keeps page boundaries live, and unsubscribes on stop', async () => {
    const rows = Array.from({ length: 85 }, (_, index) => message('m' + index, 'Текст ' + index, 'tg:2', index));
    const f = fixture(rows), session = new DiscussionSession(f.port, { threadId: 'thread', anchor });
    session.start();
    await vi.waitFor(() => expect(session.snapshot().messages).toHaveLength(40));
    expect(await session.locate('m0')).toBe(true);
    await vi.waitFor(() => expect(session.snapshot().messages).toHaveLength(85));
    f.replace([...rows, message('m85', 'Новое сообщение', 'tg:2', 85)]);
    await vi.waitFor(() => expect(session.snapshot().messages).toHaveLength(86));
    expect(session.snapshot().messages[0].id).toBe('m0');
    const next = vi.fn(), unsubscribe = session.subscribe(next);
    session.stop(); unsubscribe(); expect(f.observers.size).toBe(0);
    f.replace([]); expect(next).not.toHaveBeenCalled();
  });
  it('ignores late title results after close and late locate after switching away', async () => {
    const f = fixture(), session = new DiscussionSession(f.port, { threadId: 'thread', anchor });
    let resolve: (value: Awaited<ReturnType<typeof f.port.listThreads>>) => void = () => {};
    vi.spyOn(f.port, 'listThreads').mockImplementation(() => new Promise(done => { resolve = done; }));
    session.start(); session.stop(); resolve([]);
    await Promise.resolve(); expect(f.observers.size).toBe(0);
    const ready = new DiscussionSession(f.port, { threadId: 'thread', anchor });
    let release: (value: ReturnType<typeof message>) => void = () => {};
    vi.spyOn(f.port, 'getMessage').mockImplementation(() => new Promise(done => { release = done; }));
    ready.start(); const locating = ready.locate('old'); ready.stop(); release(message('old'));
    expect(await locating).toBe(false);
  });
  it('reports recoverable query failure and rejects an anchor without the requested thread', async () => {
    const f = fixture(), session = new DiscussionSession(f.port, { threadId: 'thread', anchor });
    session.start(); await vi.waitFor(() => expect(session.snapshot().loading).toBe(false));
    f.fail(); expect(session.snapshot().error).toBe('Не удалось загрузить сообщения');
    session.retry(); await vi.waitFor(() => expect(session.snapshot().error).toBeNull());
    session.stop();
    const missing = new DiscussionSession(f.port, { threadId: 'foreign', anchor }); missing.start();
    await vi.waitFor(() => expect(missing.snapshot().error).toBe('Ветка недоступна')); missing.stop();
  });
});
