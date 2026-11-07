import { describe, expect, it, vi } from 'vitest';
import { DiscussionSession } from './discussion-session';
import { anchor, fixture, message } from './discussion-fixture.test-support';
describe('revealed discussion history boundary', () => {
  it.each([40, 80])('keeps a fully revealed exact-page history of %i messages when a new message creates another page', async count => {
    const rows = Array.from({ length: count }, (_, i) => message('m' + i, 'History ' + i, 'tg:2', i));
    const f = fixture(rows), session = new DiscussionSession(f.port, { threadId: 'thread', anchor });
    session.start(); await vi.waitFor(() => expect(session.snapshot().loading).toBe(false));
    if (count > 40) session.loadMore();
    await vi.waitFor(() => expect(session.snapshot().messages).toHaveLength(count));
    expect(session.snapshot().more).toBe(false);
    f.replace([...rows, message('new', 'Incoming', 'tg:2', count)]);
    await vi.waitFor(() => expect(session.snapshot().messages).toHaveLength(count + 1));
    expect(session.snapshot().messages[0].id).toBe('m0');
    expect(session.snapshot().more).toBe(false);
    f.replace([{ ...rows[0], text: '', deleted: true }, ...rows.slice(1), message('new', 'Incoming', 'tg:2', count)]);
    await vi.waitFor(() => expect(session.snapshot().messages[0].deleted).toBe(true));
    session.stop(); expect(f.observers.size).toBe(0);
  });
  it('retains a partial revealed boundary through a burst larger than a page and retry', async () => {
    const rows = Array.from({ length: 160 }, (_, i) => message('m' + i, String(i), 'tg:2', i));
    const f = fixture(rows), session = new DiscussionSession(f.port, { threadId: 'thread', anchor });
    session.start(); await vi.waitFor(() => expect(session.snapshot().loading).toBe(false));
    session.loadMore(); await vi.waitFor(() => expect(session.snapshot().messages).toHaveLength(80));
    const incoming = Array.from({ length: 45 }, (_, i) => message('new' + i, 'Incoming', 'tg:2', 160 + i));
    f.replace([...rows, ...incoming]);
    await vi.waitFor(() => {
      expect(session.snapshot().loading).toBe(false);
      expect(session.snapshot().messages.some(row => row.id === 'm80')).toBe(true);
      expect(session.snapshot().messages.at(-1)?.id).toBe('new44');
    });
    session.retry(); await vi.waitFor(() => {
      expect(session.snapshot().loading).toBe(false);
      expect(session.snapshot().messages.some(row => row.id === 'm80')).toBe(true);
    });
    session.stop(); expect(f.observers.size).toBe(0);
  });
});
