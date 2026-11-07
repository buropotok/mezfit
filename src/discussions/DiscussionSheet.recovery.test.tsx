// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { KonstaProvider } from 'konsta/react';
import { DiscussionSheet, type DiscussionSheetProps } from './DiscussionSheet';
import { anchor, fixture, message } from './discussion-fixture.test-support';
import type { DiscussionMessageInput } from '../data/cloud/discussions';
import type { LiquidPopoverProps } from '../ui/LiquidPopover';
vi.mock('../ui/LiquidPopover', () => ({ LiquidPopover: (props: LiquidPopoverProps) => <>
  {props.trigger}{props.isOpen && <div role="menu">{props.items?.map(item =>
    <button key={item.id} onClick={() => item.onSelect?.()}>{item.label}</button>)}</div>}
</> }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
function setup() {
  const f = fixture();
  let saved: DiscussionMessageInput | null = null;
  const repository = { ...f.port,
    getDraft: vi.fn(async () => saved ? { ...saved } : null),
    saveDraft: vi.fn(async (input: DiscussionMessageInput) => { saved = { ...input }; }),
    send: vi.fn(async (input: DiscussionMessageInput) => { saved = null; return message(input.id, input.text); }),
  };
  const props: DiscussionSheetProps = { opened: true, repository, threadId: 'thread', anchor,
    resolveAuthor: id => ({ name: id }), onClose: vi.fn(), onNavigationContextChange: vi.fn(), parentNavigation: null };
  const view = render(<KonstaProvider theme="ios" dark><DiscussionSheet {...props} /></KonstaProvider>);
  return { ...f, ...view, props, repository };
}
const input = () => screen.getByPlaceholderText('Сообщение') as HTMLTextAreaElement;
async function ready() { await waitFor(() => expect(input().disabled).toBe(false)); }
describe('discussion composer persistence and reading position', () => {
  it('recovers unsent text, reply target and message ID after closing; retry keeps the same command', async () => {
    const f = setup(); await ready();
    fireEvent.click(screen.getByText('Чужой текст'));
    fireEvent.click(screen.getByRole('button', { name: 'Ответить' }));
    fireEvent.change(input(), { target: { value: 'Remember this reply' } });
    await waitFor(() => expect(f.repository.saveDraft).toHaveBeenLastCalledWith(expect.objectContaining({ text: 'Remember this reply', replyToMessageId: 'other' })));
    const id = f.repository.saveDraft.mock.calls.at(-1)?.[0].id;
    f.rerender(<KonstaProvider theme="ios" dark><DiscussionSheet {...f.props} opened={false} /></KonstaProvider>);
    f.rerender(<KonstaProvider theme="ios" dark><DiscussionSheet {...f.props} /></KonstaProvider>);
    await ready(); expect(input().value).toBe('Remember this reply');
    f.repository.send.mockRejectedValueOnce(Error('Local failure'));
    fireEvent.click(screen.getByRole('button', { name: 'Отправить' }));
    await screen.findByText('Не удалось выполнить действие. Повторите попытку');
    fireEvent.click(screen.getByRole('button', { name: 'Отправить' }));
    await waitFor(() => expect(f.repository.send).toHaveBeenCalledTimes(2));
    expect(f.repository.send.mock.calls.map(call => call[0].id)).toEqual([id, id]);
    expect(f.repository.send.mock.calls[1][0].replyToMessageId).toBe('other');
    await waitFor(() => expect(input().value).toBe(''));
  });
  it('does not overwrite a stored composer draft while editing another message', async () => {
    const f = setup(); await ready();
    fireEvent.change(input(), { target: { value: 'Unsent draft' } });
    fireEvent.click(screen.getByText('Мой текст'));
    fireEvent.click(screen.getByRole('button', { name: 'Редактировать' }));
    fireEvent.change(screen.getByPlaceholderText('Редактировать сообщение'), { target: { value: 'Edited message' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(f.repository.edit).toHaveBeenCalledWith('thread', 'own', 'Edited message'));
    await ready(); expect(input().value).toBe('Unsent draft');
    expect(f.repository.saveDraft).toHaveBeenLastCalledWith(expect.objectContaining({ text: 'Unsent draft' }));
  });
  it('keeps recovery errors retryable without allowing an empty composer to overwrite the draft', async () => {
    const f = fixture();
    const repository = { ...f.port, getDraft: vi.fn().mockRejectedValueOnce(Error('Read failure'))
      .mockResolvedValue({ id: 'saved', threadId: 'thread', text: 'Recovered', createdAt: '2026-11-07T00:00:00.000Z' }), saveDraft: vi.fn() };
    render(<KonstaProvider theme="ios" dark><DiscussionSheet opened repository={repository} threadId="thread" anchor={anchor}
      onClose={vi.fn()} resolveAuthor={id => ({ name: id })} onNavigationContextChange={vi.fn()} parentNavigation={null} /></KonstaProvider>);
    await screen.findByText('Не удалось восстановить черновик'); expect(input().disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Повторить сохранение черновика' }));
    await ready(); expect(input().value).toBe('Recovered'); expect(repository.saveDraft).not.toHaveBeenCalled();
  });
  it('keeps a failed local save retryable and recovers it after retry and close', async () => {
    const f = setup(); await ready();
    f.repository.saveDraft.mockRejectedValueOnce(Error('Local write failure'));
    fireEvent.change(input(), { target: { value: 'Retry draft save' } });
    await screen.findByText('Не удалось сохранить черновик');
    fireEvent.click(screen.getByRole('button', { name: 'Повторить сохранение черновика' }));
    await waitFor(() => expect(screen.queryByText('Не удалось сохранить черновик')).toBeNull());
    expect(input().value).toBe('Retry draft save');
    f.rerender(<KonstaProvider theme="ios" dark><DiscussionSheet {...f.props} opened={false} /></KonstaProvider>);
    f.rerender(<KonstaProvider theme="ios" dark><DiscussionSheet {...f.props} /></KonstaProvider>);
    await ready(); expect(input().value).toBe('Retry draft save');
  });
  it('ignores old account draft hydration after switching repository', async () => {
    const f = setup(); await ready();
    let release: (input: DiscussionMessageInput | null) => void = () => {};
    const old = { ...f.repository, getDraft: vi.fn(() => new Promise<DiscussionMessageInput | null>(resolve => { release = resolve; })) };
    f.rerender(<KonstaProvider theme="ios" dark><DiscussionSheet {...f.props} repository={old} /></KonstaProvider>);
    const current = { ...f.repository, getDraft: vi.fn(async () => ({ id: 'new-draft', threadId: 'thread', text: 'Current account', createdAt: '2026-11-07T00:00:00.000Z' })) };
    f.rerender(<KonstaProvider theme="ios" dark><DiscussionSheet {...f.props} repository={current} /></KonstaProvider>);
    await ready();
    await act(async () => release({ id: 'old-draft', threadId: 'thread', text: 'Old account', createdAt: '2026-11-07T00:00:00.000Z' }));
    expect(input().value).toBe('Current account');
    expect(current.saveDraft).not.toHaveBeenCalled();
  });
  it('anchors the visible row when live rows above it change height', async () => {
    const f = setup(); await ready();
    const list = f.container.querySelector<HTMLDivElement>('.discussion-thread__scroll');
    const row = f.container.querySelector<HTMLDivElement>('[data-message-id="own"]');
    if (!list || !row) throw Error('Missing owned scroll/row');
    Object.defineProperties(list, { scrollHeight: { configurable: true, value: 1000 }, clientHeight: { configurable: true, value: 200 } });
    const rectangle = (top: number, height: number): DOMRect => ({ top, bottom: top + height, left: 0, right: 300, width: 300, height, x: 0, y: top, toJSON: () => ({}) });
    vi.spyOn(list, 'getBoundingClientRect').mockImplementation(() => rectangle(0, 200));
    let top = 20;
    vi.spyOn(row, 'getBoundingClientRect').mockImplementation(() => rectangle(top, 50));
    list.scrollTop = 200; fireEvent.scroll(list);
    top = 70;
    act(() => f.replace([message('own', 'Changed height'), message('other', 'Чужой текст', 'tg:2', 1)]));
    await screen.findByText('Changed height'); expect(list.scrollTop).toBe(250);
  });
  it('preserves the separate saved draft when switching from edit to reply and reopening', async () => {
    const f = setup(); await ready();
    fireEvent.change(input(), { target: { value: 'Separate unsent text' } });
    fireEvent.click(screen.getByText('Мой текст'));
    fireEvent.click(screen.getByRole('button', { name: 'Редактировать' }));
    fireEvent.change(screen.getByPlaceholderText('Редактировать сообщение'), { target: { value: 'Temporary edit' } });
    fireEvent.click(screen.getByText('Чужой текст'));
    fireEvent.click(screen.getByRole('button', { name: 'Ответить' }));
    expect(input().value).toBe('Separate unsent text');
    await waitFor(() => expect(f.repository.saveDraft).toHaveBeenLastCalledWith(expect.objectContaining({
      text: 'Separate unsent text', replyToMessageId: 'other',
    })));
    f.rerender(<KonstaProvider theme="ios" dark><DiscussionSheet {...f.props} opened={false} /></KonstaProvider>);
    f.rerender(<KonstaProvider theme="ios" dark><DiscussionSheet {...f.props} /></KonstaProvider>);
    await ready(); expect(input().value).toBe('Separate unsent text');
    fireEvent.click(screen.getByRole('button', { name: 'Отправить' }));
    await waitFor(() => expect(f.repository.send).toHaveBeenCalledWith(expect.objectContaining({
      text: 'Separate unsent text', replyToMessageId: 'other', requireUnsentDraft: true,
    })));
  });
  it('forks only once from a published recovered ID and preserves later typing despite stale save failures', async () => {
    const f = setup(); await ready();
    const shared = { id: 'shared-draft', threadId: 'thread', text: 'Old synchronized text', createdAt: '2026-11-07T00:00:00.000Z' };
    f.repository.getDraft.mockResolvedValueOnce(shared);
    f.rerender(<KonstaProvider theme="ios" dark><DiscussionSheet {...f.props} opened={false} /></KonstaProvider>);
    f.rerender(<KonstaProvider theme="ios" dark><DiscussionSheet {...f.props} /></KonstaProvider>);
    await ready();
    let rejectOld: (reason: Error) => void = () => {};
    f.repository.saveDraft.mockImplementationOnce(() => new Promise<void>((_resolve, reject) => { rejectOld = reject; }))
      .mockRejectedValueOnce(Error('DISCUSSION_ID_REUSED'));
    fireEvent.change(input(), { target: { value: 'First new edit' } });
    fireEvent.change(input(), { target: { value: 'Latest new edit' } });
    await waitFor(() => expect(f.repository.saveDraft).toHaveBeenCalledTimes(3));
    const replacement = f.repository.saveDraft.mock.calls[2][0];
    expect(replacement.id).not.toBe(shared.id); expect(replacement.text).toBe('Latest new edit');
    await act(async () => rejectOld(Error('DISCUSSION_ID_REUSED')));
    expect(f.repository.saveDraft).toHaveBeenCalledTimes(3); expect(input().value).toBe('Latest new edit');
    fireEvent.click(screen.getByRole('button', { name: 'Отправить' }));
    await waitFor(() => expect(f.repository.send).toHaveBeenCalledWith(expect.objectContaining({
      id: replacement.id, text: 'Latest new edit', requireUnsentDraft: true,
    })));
  });
  it('keeps text when another device publishes after the last save but before Send, then sends it with a new ID', async () => {
    const f = setup(); await ready();
    fireEvent.change(input(), { target: { value: 'Keep this new intent' } });
    const oldId = f.repository.saveDraft.mock.calls.at(-1)?.[0].id;
    f.repository.send.mockRejectedValueOnce(Error('DISCUSSION_DRAFT_ALREADY_PUBLISHED'));
    fireEvent.click(screen.getByRole('button', { name: 'Отправить' }));
    await screen.findByText('Не удалось выполнить действие. Повторите попытку');
    expect(input().value).toBe('Keep this new intent');
    const replacement = f.repository.saveDraft.mock.calls.at(-1)?.[0];
    expect(replacement?.id).not.toBe(oldId); expect(replacement?.text).toBe('Keep this new intent');
    fireEvent.click(screen.getByRole('button', { name: 'Отправить' }));
    await waitFor(() => expect(f.repository.send).toHaveBeenCalledTimes(2));
    expect(f.repository.send.mock.calls[1][0].id).toBe(replacement?.id);
    await waitFor(() => expect(input().value).toBe(''));
  });

});
