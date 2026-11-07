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
  it('waits for the exact live target despite incoming messages shifting the older pages', async () => {
    const rows = Array.from({ length: 85 }, (_, i) => message('m' + i, 'Текст ' + i, 'tg:2', i));
    const incoming = Array.from({ length: 40 }, (_, i) => message('new' + i, 'Новое ' + i, 'tg:2', i + 85));
    const f = fixture(rows), observe = vi.mocked(f.port.observePage).getMockImplementation();
    if (!observe) throw Error('Missing fixture page observer implementation');
    let inject = true;
    vi.spyOn(f.port, 'observePage').mockImplementation((id, next, error, before, limit) =>
      observe(id, page => {
        if (before && inject) { inject = false; f.replace([...rows, ...incoming]); }
        next(page);
      }, error, before, limit));
    const session = new DiscussionSession(f.port, { threadId: 'thread', anchor });
    session.start(); await vi.waitFor(() => expect(session.snapshot().messages).toHaveLength(40));
    expect(await session.locate('m0')).toBe(true);
    expect(session.snapshot().messages.some(row => row.id === 'm0')).toBe(true);
    expect(session.snapshot().messages).toHaveLength(125);
    session.stop();
  });
  it('retains visible history while live cursors settle and retains a failed page error until retry', async () => {
    const rows = Array.from({ length: 85 }, (_, i) => message('m' + i, 'Текст ' + i, 'tg:2', i));
    const f = fixture(rows), session = new DiscussionSession(f.port, { threadId: 'thread', anchor });
    session.start(); await vi.waitFor(() => expect(session.snapshot().loading).toBe(false));
    await session.locate('m0');
    const sizes: number[] = [];
    const unsubscribe = session.subscribe(() => sizes.push(session.snapshot().messages.length));
    f.replace([...rows, message('new', 'Новое', 'tg:2', 86)]);
    await vi.waitFor(() => expect(session.snapshot().messages).toHaveLength(86));
    expect(sizes.every(size => size >= 85)).toBe(true);
    const older = [...f.observers].find(observer => observer.before);
    if (!older) throw Error('Missing older page');
    older.error(Error('Failed older page'));
    const latest = [...f.observers].find(observer => !observer.before);
    if (!latest) throw Error('Missing latest page');
    const top = await f.port.page('thread');
    latest.next(top);
    expect(session.snapshot().error).toBe('Не удалось загрузить сообщения');
    session.retry();
    await vi.waitFor(() => {
      expect(session.snapshot().loading).toBe(false);
      expect(session.snapshot().error).toBeNull();
      expect(session.snapshot().messages).toHaveLength(86);
    });
    unsubscribe(); session.stop();
  });
  it('cancels a jump waiting for a live page without waiting for that page to arrive', async () => {
    const rows = Array.from({ length: 85 }, (_, i) => message('m' + i, 'Текст ' + i, 'tg:2', i));
    const f = fixture(rows), observe = vi.mocked(f.port.observePage).getMockImplementation();
    if (!observe) throw Error('Missing fixture page observer implementation');
    let delayed: (() => void) | undefined;
    vi.spyOn(f.port, 'observePage').mockImplementation((id, next, error, before, limit) =>
      observe(id, page => { if (before) delayed = () => next(page); else next(page); }, error, before, limit));
    const session = new DiscussionSession(f.port, { threadId: 'thread', anchor });
    session.start(); await vi.waitFor(() => expect(session.snapshot().loading).toBe(false));
    const locating = session.locate('m0');
    await vi.waitFor(() => expect(delayed).toBeDefined());
    session.cancelLocate();
    expect(await locating).toBe(false);
    session.stop(); delayed?.(); expect(f.observers.size).toBe(0);
  });

});
