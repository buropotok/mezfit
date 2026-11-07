// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { KonstaProvider } from 'konsta/react';
import { DiscussionSheet, type DiscussionSheetProps } from './DiscussionSheet';
import { anchor, fixture, message } from './discussion-fixture.test-support';
import type { LiquidPopoverProps } from '../ui/LiquidPopover';
import type { NavigationContext } from '../NavigationShell';
import type { DiscussionReceiptSnapshot } from '../data/cloud/discussion-views';
const popoverCalls = vi.hoisted(() => [] as Array<Pick<LiquidPopoverProps, 'onOpenChange' | 'items'>>);

// Keep Konsta Message/Messagebar/Sheet/Dialog real. Canvas animation has its own UIkit tests.
vi.mock('../ui/LiquidPopover', () => ({ LiquidPopover: (props: LiquidPopoverProps) => {
  popoverCalls.push(props);
  return <>
  {props.trigger}
  {props.isOpen && <div role="menu" aria-label={props.label} data-preset={props.preset} data-optics={String(props.optics)} data-blur={props.blur}>
    {props.items?.map(item => <button key={item.id} role="menuitem" data-icon={item.icon} onClick={() => item.onSelect?.()}>{item.label}</button>)}
  </div>}
</>; } }));

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); popoverCalls.splice(0); });
function mount(overrides: Partial<DiscussionSheetProps> = {}, f = fixture()) {
  const navigation = vi.fn<(value: NavigationContext | null) => void>();
  const onClose = vi.fn(), parentNavigation = { title: 'Подход 3', scrollKey: 'set:3', onBack: vi.fn() };
  const props: DiscussionSheetProps = { opened: true, repository: f.port, threadId: 'thread', anchor,
    resolveAuthor: id => ({ name: id === 'tg:1' ? 'Андрей' : 'Клиент' }), onClose,
    onNavigationContextChange: navigation, parentNavigation, ...overrides };
  const view = render(<KonstaProvider theme="ios" dark><DiscussionSheet {...props} /></KonstaProvider>);
  return { ...f, ...view, navigation, onClose, parentNavigation, props };
}
async function open(text: string) { fireEvent.click(await screen.findByText(text)); return screen.getByRole('menu'); }

describe('COMM-05 one thread UI with canonical Konsta primitives', () => {
  it('renders synchronization beneath the sheet title, not above the composer', async () => {
    const f = fixture();
    vi.mocked(f.port.sync.observe).mockImplementation(onState => {
      onState({ status: 'synced', offline: false, error: null });
      return { unsubscribe: vi.fn() };
    });
    const view = mount({}, f);
    await screen.findByText('Мой текст');
    const status = screen.getByRole('status');
    expect(status.textContent).toBe('Синхронизировано');
    expect(status.closest('.discussion-thread__identity')).not.toBeNull();
    expect(status.closest('.discussion-thread__header')).not.toBeNull();
    expect(view.container.querySelector('.discussion-composer-context')?.querySelector('[role="status"]')).toBeNull();
  });

  it('opens the ordered own/foreign tap menus, reuses Tabler icons and material settings', async () => {
    const f = mount({ glassSettings: { preset: 'frosted', optics: true, blur: 19 } });
    const menu = await open('Мой текст');
    expect(within(menu).getAllByRole('menuitem').map(item => item.textContent)).toEqual(['Ответить', 'Редактировать', 'Копировать', 'Удалить']);
    expect(within(menu).getAllByRole('menuitem').map(item => item.getAttribute('data-icon'))).toEqual(['arrow-back-up', 'edit', 'copy', 'trash']);
    expect(menu.getAttribute('data-preset')).toBe('frosted'); expect(menu.getAttribute('data-blur')).toBe('19');
    expect(menu.getAttribute('data-optics')).toBe('true');
    const source = f.container.querySelector('.discussion-menu-source');
    expect(source?.getAttribute('aria-hidden')).toBe('true');
    expect(source?.parentElement?.parentElement?.textContent).toContain('Мой текст');
    const oldMenu = popoverCalls.at(-1);
    fireEvent.click(screen.getByText('Чужой текст'));
    act(() => oldMenu?.onOpenChange(false));
    expect(within(screen.getByRole('menu')).getAllByRole('menuitem').map(item => item.textContent)).toEqual(['Ответить', 'Копировать']);
    expect(screen.queryByText('Переслать')).toBeNull(); expect(screen.queryByText('Закрепить')).toBeNull();
  });
  it('sends reply references, edits through the same composer and copies the full current text', async () => {
    const f = mount();
    await open('Чужой текст'); fireEvent.click(screen.getByRole('menuitem', { name: 'Ответить' }));
    // In a direct chat author names are hidden above bubbles by design.
    // The reply quote still identifies its author; group mode is covered separately.
    const replyQuote = screen.getByRole('button', { name: 'Перейти к исходному сообщению' });
    expect(within(replyQuote).getByText('Клиент')).toBeTruthy();
    expect(screen.getAllByText('Клиент')).toHaveLength(1);
    fireEvent.change(screen.getByPlaceholderText('Сообщение'), { target: { value: 'Ответ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Отправить' }));
    await waitFor(() => expect(f.port.send).toHaveBeenCalledWith(expect.objectContaining({ threadId: 'thread', text: 'Ответ', replyToMessageId: 'other' })));
    await waitFor(() => expect(screen.getByPlaceholderText('Сообщение').getAttribute('disabled')).toBeNull());
    await open('Мой текст'); fireEvent.click(screen.getByRole('menuitem', { name: 'Редактировать' }));
    const editor = screen.getByPlaceholderText('Редактировать сообщение');
    expect((editor as HTMLTextAreaElement).value).toBe('Мой текст');
    fireEvent.change(editor, { target: { value: 'Исправлено' } }); fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(f.port.edit).toHaveBeenCalledWith('thread', 'own', 'Исправлено'));
    await waitFor(() => expect(screen.queryByPlaceholderText('Редактировать сообщение')).toBeNull());
    const writeText = vi.fn(async (_text: string) => {}); vi.stubGlobal('navigator', { userAgent: navigator.userAgent, clipboard: { writeText } });
    const full = 'Полный текст\nВторая строка';
    vi.spyOn(f.port, 'getMessage').mockResolvedValueOnce(message('own', full));
    await open('Мой текст'); fireEvent.click(screen.getByRole('menuitem', { name: 'Копировать' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(full));
  });
  it('confirms deletion, preserves data on cancel and renders live tombstones without old text', async () => {
    const f = mount();
    await open('Мой текст'); fireEvent.click(screen.getByRole('menuitem', { name: 'Удалить' }));
    fireEvent.click(screen.getByRole('button', { name: 'Отмена' })); expect(f.port.remove).not.toHaveBeenCalled();
    await open('Мой текст'); fireEvent.click(screen.getByRole('menuitem', { name: 'Удалить' }));
    fireEvent.click(screen.getByRole('button', { name: 'Удалить' }));
    await waitFor(() => expect(f.port.remove).toHaveBeenCalledWith('thread', 'own'));
    act(() => f.replace([{ ...message('own', ''), deleted: true }, message('other', 'Чужой текст', 'tg:2', 1)]));
    expect(await screen.findByText('Сообщение удалено')).toBeTruthy(); expect(screen.queryByText('Мой текст')).toBeNull();
  });
  it('keeps the stable send command on retry and prevents double submission', async () => {
    const f = mount(); await screen.findByText('Мой текст');
    vi.spyOn(f.port, 'send').mockRejectedValueOnce(Error('Storage temporarily unavailable'));
    fireEvent.change(screen.getByPlaceholderText('Сообщение'), { target: { value: 'Повтор' } });
    fireEvent.click(screen.getByRole('button', { name: 'Отправить' }));
    fireEvent.click(screen.getByRole('button', { name: 'Отправить' }));
    await screen.findByRole('alert');
    expect(f.port.send).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Отправить' }));
    await waitFor(() => expect(f.port.send).toHaveBeenCalledTimes(2));
    expect(vi.mocked(f.port.send).mock.calls[0][0].id).toBe(vi.mocked(f.port.send).mock.calls[1][0].id);
  });
  it('loads an old focus target and highlights it without creating another thread', async () => {
    const rows = Array.from({ length: 85 }, (_, index) => message('m' + index, 'История ' + index, 'tg:2', index));
    const f = mount({ focusMessageId: 'm0' }, fixture(rows));
    const old = await screen.findByText('История 0');
    await waitFor(() => expect(old.closest('[data-message-id]')?.getAttribute('data-highlighted')).toBe('true'));
    expect(f.port.getMessage).toHaveBeenCalledWith('thread', 'm0'); expect(vi.mocked(f.port.observePage).mock.calls.length).toBeGreaterThan(1);
    expect(f.port.send).not.toHaveBeenCalled(); expect(f.port.markRead).not.toHaveBeenCalled();
  });
  it('uses the existing Back callback for menu/composer/sheet and restores the entity on unmount', async () => {
    const f = mount();
    await open('Мой текст');
    const closedMenu = popoverCalls.at(-1);
    act(() => f.navigation.mock.lastCall?.[0]?.onBack?.());
    act(() => closedMenu?.items?.find(item => item.id === 'edit')?.onSelect?.());
    expect(screen.queryByPlaceholderText('Редактировать сообщение')).toBeNull();
    expect(screen.queryByRole('menu')).toBeNull(); expect(f.onClose).not.toHaveBeenCalled();
    await open('Чужой текст'); fireEvent.click(screen.getByRole('menuitem', { name: 'Ответить' }));
    act(() => f.navigation.mock.lastCall?.[0]?.onBack?.());
    expect(screen.queryByRole('button', { name: 'Отменить ответ или редактирование' })).toBeNull();
    act(() => f.navigation.mock.lastCall?.[0]?.onBack?.()); expect(f.onClose).toHaveBeenCalledTimes(1);
    f.unmount(); expect(f.navigation.mock.lastCall?.[0]).toBe(f.parentNavigation); expect(f.observers.size).toBe(0);
  });
  it('renders the current quote author/first line, jumps without opening the menu, and hides deleted originals', async () => {
    const rows = Array.from({ length: 85 }, (_, index) => message('m' + index, 'История ' + index, 'tg:2', index));
    const reply = { ...message('reply', 'Мой ответ', 'tg:1', 86), reply: {
      messageId: 'm0', authorUserId: 'tg:2', text: 'История 0', deleted: false, unavailable: false,
    } };
    const f = mount({}, fixture([...rows, reply]));
    const quote = await screen.findByRole('button', { name: 'Перейти к исходному сообщению' });
    expect(within(quote).getByText('Клиент')).toBeTruthy();
    expect(within(quote).getByText('История 0').classList.contains('discussion-quote__text')).toBe(true);
    const editedRows = [{ ...rows[0], text: 'Исправленный оригинал\nВторая строка' }, ...rows.slice(1)];
    const editedReply = { ...reply, reply: { ...reply.reply, text: 'Исправленный оригинал' } };
    act(() => f.replace([...editedRows, editedReply]));
    expect(await within(quote).findByText('Исправленный оригинал')).toBeTruthy();
    expect(within(quote).queryByText('Вторая строка')).toBeNull();
    fireEvent.click(quote); expect(screen.queryByRole('menu')).toBeNull();
    await waitFor(() => expect(f.container.querySelector('[data-message-id="m0"]')?.getAttribute('data-highlighted')).toBe('true'));
    act(() => f.replace([{ ...rows[0], deleted: true, text: '' }, ...rows.slice(1),
      { ...reply, reply: { ...reply.reply, text: '', deleted: true } }]));
    await waitFor(() => expect(screen.queryByText(/Исправленный оригинал/)).toBeNull());
    expect(screen.getAllByText('Сообщение удалено').length).toBeGreaterThan(0);
  });
  it('scrolls the original to center and pulses only its bubble after scrollend, including repeated jumps', async () => {
    const source = message('source', 'Исходный текст', 'tg:2', 0);
    const reply = { ...message('reply', 'Ответ', 'tg:1', 1), reply: {
      messageId: 'source', authorUserId: 'tg:2', text: 'Исходный текст', deleted: false, unavailable: false,
    } };
    const f = mount({}, fixture([source, reply]));
    const quote = await screen.findByRole('button', { name: 'Перейти к исходному сообщению' });
    const list = f.container.querySelector<HTMLDivElement>('.discussion-thread__scroll');
    const row = f.container.querySelector<HTMLDivElement>('[data-message-id="source"]');
    if (!list || !row) throw new Error('Missing scroll owner or target');
    const rect = (top: number, height: number): DOMRect =>
      ({ x: 0, y: top, top, bottom: top + height, left: 0, right: 300, width: 300, height, toJSON: () => ({}) });
    Object.defineProperties(list, {
      scrollHeight: { configurable: true, value: 1600 },
      clientHeight: { configurable: true, value: 300 },
      scrollTo: { configurable: true, value: vi.fn() },
    });
    vi.spyOn(list, 'getBoundingClientRect').mockImplementation(() => rect(0, 300));
    vi.spyOn(row, 'getBoundingClientRect').mockImplementation(() => rect(800, 50));
    const scrollTo = vi.mocked(list.scrollTo);

    fireEvent.click(quote);
    await waitFor(() => expect(scrollTo).toHaveBeenCalledWith({ top: 675, behavior: 'smooth' }));
    expect(row.querySelector('.ui-mezfit-message__focus-pulse')).toBeNull();
    act(() => list.dispatchEvent(new Event('scrollend')));
    await waitFor(() => expect(row.querySelector('.ui-mezfit-message__focus-pulse')).not.toBeNull());

    fireEvent.click(quote);
    await waitFor(() => expect(scrollTo).toHaveBeenCalledTimes(2));
    expect(row.querySelector('.ui-mezfit-message__focus-pulse')).toBeNull();
    act(() => list.dispatchEvent(new Event('scrollend')));
    await waitFor(() => expect(row.querySelector('.ui-mezfit-message__focus-pulse')).not.toBeNull());
  });
  it('keeps a scrolled reader in place and follows new messages only near the end', async () => {
    const f = mount(); await screen.findByText('Мой текст');
    const list = f.container.querySelector('.discussion-thread__scroll');
    if (!(list instanceof HTMLDivElement)) throw Error('Missing scroll owner');
    Object.defineProperties(list, { scrollHeight: { configurable: true, value: 1000 }, clientHeight: { configurable: true, value: 200 } });
    list.scrollTop = 200; fireEvent.scroll(list);
    act(() => f.replace([message('own', 'Мой текст'), message('other', 'Чужой текст', 'tg:2', 1), message('third', 'Новое', 'tg:2', 2)]));
    await screen.findByText('Новое'); expect(list.scrollTop).toBe(200);
    list.scrollTop = 790; fireEvent.scroll(list);
    act(() => f.replace([message('own', 'Мой текст'), message('other', 'Чужой текст', 'tg:2', 1), message('third', 'Новое', 'tg:2', 2), message('fourth', 'Ещё', 'tg:2', 3)]));
    await screen.findByText('Ещё'); expect(list.scrollTop).toBe(1000);
  });
  it.each(['iPhone', 'Android'])('adapts to the %s visual viewport and cleans up keyboard listeners', async userAgent => {
    vi.stubGlobal('navigator', { userAgent });
    const viewport = Object.assign(new EventTarget(), { height: 400, offsetTop: 0 });
    vi.stubGlobal('visualViewport', viewport);
    const remove = vi.spyOn(viewport, 'removeEventListener');
    const f = mount(); await screen.findByText('Мой текст');
    const sheet = screen.getByRole('dialog', { name: 'Обсуждение' });
    expect(sheet.style.bottom).toBe(`${Math.max(0, window.innerHeight - 400)}px`);
    act(() => { viewport.height = 500; viewport.dispatchEvent(new Event('resize')); });
    expect(sheet.style.bottom).toBe(`${Math.max(0, window.innerHeight - 500)}px`);
    f.unmount(); expect(remove).toHaveBeenCalledWith('resize', expect.any(Function));
  });
  it('ignores a pending send after switching to another repository session', async () => {
    const f = mount(); await screen.findByText('Мой текст');
    let release: (value: ReturnType<typeof message>) => void = () => {};
    vi.spyOn(f.port, 'send').mockImplementation(() => new Promise(resolve => { release = resolve; }));
    fireEvent.change(screen.getByPlaceholderText('Сообщение'), { target: { value: 'Старое' } });
    fireEvent.click(screen.getByRole('button', { name: 'Отправить' }));
    const next = fixture();
    f.rerender(<KonstaProvider theme="ios" dark><DiscussionSheet {...f.props} repository={next.port} /></KonstaProvider>);
    await screen.findByText('Мой текст');
    fireEvent.change(screen.getByPlaceholderText('Сообщение'), { target: { value: 'Новый черновик' } });
    await act(async () => { release(message('sent')); await Promise.resolve(); });
    expect((screen.getByPlaceholderText('Сообщение') as HTMLTextAreaElement).value).toBe('Новый черновик');
    expect(f.observers.size).toBe(0);
  });
  it('clears an edit when switching to reply, and preserves reply text when Back cancels its context', async () => {
    const f = mount();
    await open('Мой текст'); fireEvent.click(screen.getByRole('menuitem', { name: 'Редактировать' }));
    fireEvent.change(screen.getByPlaceholderText('Редактировать сообщение'), { target: { value: 'Правка исходного' } });
    await open('Чужой текст'); fireEvent.click(screen.getByRole('menuitem', { name: 'Ответить' }));
    const input = screen.getByPlaceholderText('Сообщение');
    expect((input as HTMLTextAreaElement).value).toBe('');
    fireEvent.change(input, { target: { value: 'Не терять черновик' } });
    act(() => f.navigation.mock.lastCall?.[0]?.onBack?.());
    expect((input as HTMLTextAreaElement).value).toBe('Не терять черновик');
    expect(screen.queryByRole('button', { name: 'Отменить ответ или редактирование' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Отправить' }));
    await waitFor(() => expect(f.port.send).toHaveBeenCalled());
    expect(vi.mocked(f.port.send).mock.calls[0][0]).toMatchObject({ text: 'Не терять черновик', replyToMessageId: undefined });
    expect(f.port.edit).not.toHaveBeenCalled();
  });
  it('marks visible messages read on returning from the background without another incoming message', async () => {
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    const f = mount(); await screen.findByText('Мой текст');
    expect(f.port.markRead).not.toHaveBeenCalled();
    visibility.mockReturnValue('visible');
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    await waitFor(() => expect(f.port.markRead).toHaveBeenCalledWith('thread', 'other'));
  });
  it('does not scroll or highlight a cached focus before the repository validates it', async () => {
    const f = fixture();
    let reject: (reason: Error) => void = () => {};
    vi.spyOn(f.port, 'getMessage').mockImplementation(() => new Promise((_, fail) => { reject = fail; }));
    const view = mount({ focusMessageId: 'own' }, f);
    await screen.findByText('Мой текст');
    await waitFor(() => expect(f.port.getMessage).toHaveBeenCalledWith('thread', 'own'));
    expect(view.container.querySelector('[data-highlighted]')).toBeNull();
    await act(async () => { reject(Error('Access no longer available')); await Promise.resolve(); });
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(view.container.querySelector('[data-highlighted]')).toBeNull();
    expect(f.port.markRead).not.toHaveBeenCalled();
  });
  it('changes one check to two only for the recipient cursor of the message storage thread', async () => {
    const f = fixture();
    let emit: (snapshot: DiscussionReceiptSnapshot) => void = () => {};
    f.port.observeReceipts = (_thread, next) => {
      emit = next;
      queueMicrotask(() => next({ confirmedIds: ['own'], recipientReadThrough: [] }));
      return { unsubscribe: vi.fn() };
    };
    mount({}, f);
    await screen.findByRole('img', { name: 'Отправка подтверждена Dexie Cloud' });
    act(() => emit({ confirmedIds: ['own'], recipientReadThrough: [
      { id: 'own', createdAt: threadTime(), threadId: 'other-storage-thread' },
    ] }));
    expect(screen.queryByRole('img', { name: 'Прочитано собеседником' })).toBeNull();
    act(() => emit({ confirmedIds: ['own'], recipientReadThrough: [
      { id: 'own', createdAt: threadTime(), threadId: 'thread' },
    ] }));
    expect(screen.getByRole('img', { name: 'Прочитано собеседником' })).toBeTruthy();
    expect(screen.queryByRole('img', { name: 'Отправка подтверждена Dexie Cloud' })).toBeNull();
    function threadTime() { return message('own').createdAt; }
  });
  it('retries a failed local read mark without resending or waiting for cloud delivery', async () => {
    const fixtureData = fixture();
    vi.mocked(fixtureData.port.markRead).mockRejectedValueOnce(Error('Local write failed'));
    mount({}, fixtureData);
    await screen.findByText('Не удалось отметить сообщения прочитанными');
    fireEvent.click(screen.getByRole('button', { name: 'Повторить отметку прочтения' }));
    await waitFor(() => expect(screen.queryByText('Не удалось отметить сообщения прочитанными')).toBeNull());
    expect(fixtureData.port.markRead).toHaveBeenLastCalledWith('thread', 'other');
    expect(fixtureData.port.send).not.toHaveBeenCalled();
  });
  it('groups dates using the same local calendar as the displayed date', async () => {
    vi.spyOn(Date.prototype, 'toLocaleDateString').mockReturnValue('07.11.2026');
    const rows = [{ ...message('late', 'До полуночи UTC'), createdAt: '2026-11-06T23:10:00.000Z' },
      { ...message('early', 'После полуночи UTC'), createdAt: '2026-11-07T00:10:00.000Z' }];
    mount({}, fixture(rows));
    await screen.findByText('После полуночи UTC');
    expect(screen.getAllByText('07.11.2026')).toHaveLength(1);
  });

});
