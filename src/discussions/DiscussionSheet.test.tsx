// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { KonstaProvider } from 'konsta/react';
import { DiscussionSheet, type DiscussionSheetProps } from './DiscussionSheet';
import { anchor, fixture, message } from './discussion-fixture.test-support';
import type { LiquidPopoverProps } from '../ui/LiquidPopover';
import type { NavigationContext } from '../NavigationShell';
const popoverCalls = vi.hoisted(() => [] as Array<{ onOpenChange: (open: boolean) => void }>);

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
    expect(screen.getAllByText('Клиент').length).toBeGreaterThan(1);
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
    expect(f.port.getMessage).toHaveBeenCalledWith('thread', 'm0'); expect(f.port.page).toHaveBeenCalled();
    expect(f.port.send).not.toHaveBeenCalled(); expect(f.port.markRead).not.toHaveBeenCalled();
  });
  it('uses the existing Back callback for menu/composer/sheet and restores the entity on unmount', async () => {
    const f = mount();
    await open('Мой текст');
    act(() => f.navigation.mock.lastCall?.[0]?.onBack?.());
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
});
