import { Fragment, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ChangeEvent, type ReactNode } from 'react';
import { Button, Messagebar, Messages, MessagesTitle } from 'konsta/react';
import { prepareDiscussionMessage, type DiscussionMessageInput } from '../data/cloud/discussions';
import type { DiscussionMessageView, DiscussionQuote } from '../data/cloud/discussion-views';
import type { DiscussionSyncState } from '../data/cloud/discussion-sync';
import type { NavigationContext } from '../NavigationShell';
import { Avatar, IconButton, Text } from '../ui/primitives';
import { LiquidPopover, type LiquidPopoverItem } from '../ui/LiquidPopover';
import { MezfitBottomSheet } from '../ui/konsta-mezfit/BottomSheet';
import { MezfitMessage } from '../ui/konsta-mezfit/Message';
import { MezfitDialog, MezfitDialogButton } from '../ui/konsta-mezfit/Dialog';
import { loadBrowserGlassSettings, type GlassSettings } from '../glassSettings';
import { DiscussionSession, type DiscussionPort, type DiscussionTarget } from './discussion-session';
import { useDiscussionViewport } from './useDiscussionViewport';
import './discussion-sheet.css';

export interface DiscussionAuthor { name: string; avatarSrc?: string }
export interface DiscussionSheetProps extends DiscussionTarget {
  opened: boolean;
  repository: DiscussionPort;
  onClose: () => void;
  resolveAuthor: (userId: string) => DiscussionAuthor;
  /** The existing shell remains the single owner of browser/Telegram Back. */
  onNavigationContextChange: (context: NavigationContext | null) => void;
  parentNavigation: NavigationContext | null;
  glassSettings?: GlassSettings;
  renderAttachment?: (message: DiscussionMessageView) => ReactNode;
}

function Quote({ quote, resolveAuthor, onJump }: {
  quote: DiscussionQuote; resolveAuthor: DiscussionSheetProps['resolveAuthor']; onJump?: () => void;
}) {
  return <button type="button" className="discussion-quote" disabled={quote.unavailable} onClick={event => {
    event.stopPropagation(); onJump?.();
  }} aria-label="Перейти к исходному сообщению">
    <Text variant="caption">{quote.authorUserId ? resolveAuthor(quote.authorUserId).name : 'Исходное сообщение'}</Text>
    <Text variant="footnote" className="discussion-quote__text">{quote.deleted ? 'Сообщение удалено'
      : quote.unavailable ? 'Сообщение недоступно' : quote.text}</Text>
  </button>;
}

/** One open thread. Future entity/push integrations supply the exact target and an opted-in repository. */
export function DiscussionSheet(props: DiscussionSheetProps) {
  const viewport = useDiscussionViewport(props.opened);
  const repositoryKey = useMemo(() => crypto.randomUUID(), [props.repository]);
  const identity = JSON.stringify([repositoryKey, props.threadId, props.anchor, props.repository.actorUserId]);
  return <MezfitBottomSheet opened={props.opened} label="Обсуждение" lazyMount style={viewport}
    contentClassName="discussion-sheet-content">
    {props.opened && <OpenDiscussion key={identity} {...props} />}
  </MezfitBottomSheet>;
}

function OpenDiscussion({ repository, threadId, anchor, focusMessageId, onClose, resolveAuthor,
  onNavigationContextChange, parentNavigation, glassSettings, renderAttachment }: DiscussionSheetProps) {
  const targetKey = JSON.stringify([threadId, anchor]);
  const session = useMemo(() => new DiscussionSession(repository, { threadId, anchor }), [repository, targetKey]);
  const state = useSyncExternalStore(session.subscribe, session.snapshot, session.snapshot);
  const [text, setText] = useState('');
  const [replyId, setReplyId] = useState<string | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ id: string; open: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [syncState, setSyncState] = useState<DiscussionSyncState | null>(null);
  const [requestedFocus, setRequestedFocus] = useState<string | null>(focusMessageId ?? null);
  const [highlight, setHighlight] = useState<string | null>(null);
  const [atEnd, setAtEnd] = useState(!focusMessageId);
  const [composerHeight, setComposerHeight] = useState(64);
  const [contextHeight, setContextHeight] = useState(0);
  const scroller = useRef<HTMLDivElement>(null), context = useRef<HTMLDivElement>(null);
  const composer = useRef<HTMLElement>(null), trigger = useRef<HTMLButtonElement>(null);
  const rows = useRef(new Map<string, HTMLDivElement>());
  const alive = useRef(false), pending = useRef(false), actionVersion = useRef(0);
  const prepared = useRef<DiscussionMessageInput | null>(null);
  const preserveScroll = useRef<{ height: number; top: number } | null>(null);
  const highlightTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const lastRead = useRef<string | null>(null), focusVersion = useRef(0);
  const back = useRef<() => void>(() => {});
  const textareaId = useId();

  useEffect(() => {
    alive.current = true; session.start();
    const sync = repository.sync.observe(value => { if (alive.current) setSyncState(value); });
    return () => { alive.current = false; ++actionVersion.current; ++focusVersion.current;
      session.stop(); sync.unsubscribe(); clearTimeout(highlightTimer.current); };
  }, [session, repository]);
  const closeMenu = () => setMenu(current => current?.open ? { ...current, open: false } : current);
  back.current = () => {
    if (deletingId) { setDeletingId(null); return; }
    if (menu?.open) { closeMenu(); return; }
    if (replyId || editId) { setReplyId(null); setEditId(null); setText(''); return; }
    onClose();
  };
  useEffect(() => {
    // Preserve the underlying entity and its scroll identity; no independent history/Back listeners.
    onNavigationContextChange({ ...parentNavigation, title: parentNavigation?.title ?? 'Обсуждение',
      onBack: () => back.current() });
    return () => onNavigationContextChange(parentNavigation);
  }, [onNavigationContextChange, parentNavigation, session]);

  useLayoutEffect(() => {
    const measure = () => {
      setComposerHeight(composer.current?.getBoundingClientRect().height || 64);
      setContextHeight(context.current?.getBoundingClientRect().height || 0);
    };
    measure();
    window.addEventListener('resize', measure);
    if (typeof ResizeObserver === 'undefined') return () => window.removeEventListener('resize', measure);
    const observer = new ResizeObserver(measure);
    if (composer.current) observer.observe(composer.current);
    if (context.current) observer.observe(context.current);
    return () => { observer.disconnect(); window.removeEventListener('resize', measure); };
  }, [replyId, editId, error, syncState?.status, syncState?.offline]);

  const jump = async (id: string) => {
    const version = ++focusVersion.current;
    setAtEnd(false); setRequestedFocus(id); closeMenu();
    try {
      const found = await session.locate(id);
      if (alive.current && version === focusVersion.current && !found) {
        setRequestedFocus(null); setError('Исходное сообщение недоступно');
      }
    } catch { if (alive.current && version === focusVersion.current) {
      setRequestedFocus(null); setError('Не удалось перейти к сообщению');
    } }
  };
  const deepFocus = useRef<string | null>(null);
  useEffect(() => {
    ++focusVersion.current; session.cancelLocate(); deepFocus.current = null;
    setRequestedFocus(focusMessageId ?? null);
  }, [focusMessageId, session]);
  useEffect(() => {
    if (!focusMessageId) { deepFocus.current = null; return; }
    if (state.loading || !state.title || deepFocus.current === focusMessageId) return;
    deepFocus.current = focusMessageId; void jump(focusMessageId);
  }, [focusMessageId, state.loading, state.title, session]);
  useLayoutEffect(() => {
    const list = scroller.current;
    if (!list) return;
    if (requestedFocus) {
      const row = rows.current.get(requestedFocus);
      if (!row) return;
      const top = row.getBoundingClientRect().top - list.getBoundingClientRect().top + list.scrollTop
        - (list.clientHeight - row.getBoundingClientRect().height) / 2;
      list.scrollTo?.({ top: Math.max(0, top), behavior: 'smooth' });
      setHighlight(requestedFocus); setRequestedFocus(null);
      clearTimeout(highlightTimer.current);
      highlightTimer.current = setTimeout(() => { if (alive.current) setHighlight(null); }, 1200);
      preserveScroll.current = null;
    } else if (preserveScroll.current) {
      list.scrollTop = preserveScroll.current.top + list.scrollHeight - preserveScroll.current.height;
      preserveScroll.current = null;
    } else if (atEnd) list.scrollTop = list.scrollHeight;
  }, [state.messages, requestedFocus, atEnd, composerHeight, contextHeight]);
  useEffect(() => {
    if (!atEnd || state.loading || requestedFocus || document.visibilityState === 'hidden') return;
    const newest = [...state.messages].reverse().find(message => !message.deleted && message.authorUserId !== repository.actorUserId);
    if (!newest || lastRead.current === newest.id) return;
    lastRead.current = newest.id;
    void repository.markRead(threadId, newest.id).catch(() => {
      if (alive.current) { lastRead.current = null; setError('Не удалось отметить сообщения прочитанными'); }
    });
  }, [atEnd, state.messages, state.loading, requestedFocus, repository, threadId]);

  useEffect(() => {
    if (menu && !state.messages.some(row => row.id === menu.id && !row.deleted)) setMenu(null);
    if (editId && state.messages.some(row => row.id === editId && row.deleted)) {
      setEditId(null); setText(''); setError('Сообщение уже удалено');
    }
  }, [state.messages, menu?.id, editId]);
  const run = async (operation: () => Promise<void>) => {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError(null);
    const version = ++actionVersion.current;
    try { await operation(); }
    catch { if (alive.current && version === actionVersion.current) setError('Не удалось выполнить действие. Повторите попытку'); }
    finally { pending.current = false; if (alive.current && version === actionVersion.current) setBusy(false); }
  };
  const submit = () => void run(async () => {
    if (!text.trim()) return;
    if (editId) await repository.edit(threadId, editId, text);
    else {
      if (!prepared.current || prepared.current.text !== text || prepared.current.replyToMessageId !== (replyId ?? undefined))
        prepared.current = prepareDiscussionMessage(threadId, text, replyId ?? undefined);
      await repository.send(prepared.current);
    }
    if (alive.current) { prepared.current = null; setText(''); setEditId(null); setReplyId(null); }
  });
  const selected = menu ? state.messages.find(row => row.id === menu.id && !row.deleted) : undefined;
  const choose = (action: 'reply' | 'edit' | 'copy' | 'delete') => {
    if (!selected || !menu?.open || pending.current) return;
    const id = selected.id; closeMenu();
    const row = session.snapshot().messages.find(message => message.id === id && !message.deleted);
    if (!row) return;
    if (action === 'reply') { setEditId(null); setReplyId(id); }
    if (action === 'edit' && row.authorUserId === repository.actorUserId) { setReplyId(null); setEditId(id); setText(row.text); }
    if (action === 'delete' && row.authorUserId === repository.actorUserId) setDeletingId(id);
    if (action === 'copy') void run(async () => {
      const current = await repository.getMessage(threadId, id);
      if (!alive.current || current.deleted) return;
      if (!navigator.clipboard?.writeText) throw new Error('CLIPBOARD_UNAVAILABLE');
      await navigator.clipboard.writeText(current.text);
    });
  };
  const own = selected?.authorUserId === repository.actorUserId;
  const items: LiquidPopoverItem[] = [
    { id: 'reply', label: 'Ответить', icon: 'arrow-back-up', onSelect: () => choose('reply') },
    ...(own ? [{ id: 'edit', label: 'Редактировать', icon: 'edit' as const, onSelect: () => choose('edit') }] : []),
    { id: 'copy', label: 'Копировать', icon: 'copy', onSelect: () => choose('copy') },
    ...(own ? [{ id: 'delete', label: 'Удалить', icon: 'trash' as const, onSelect: () => choose('delete') }] : []),
  ];
  const replying = replyId ? state.messages.find(row => row.id === replyId) : undefined;
  const replyQuote: DiscussionQuote | null = replyId ? { messageId: replyId,
    authorUserId: replying?.authorUserId ?? null, deleted: Boolean(replying?.deleted), unavailable: !replying,
    text: replying && !replying.deleted ? replying.text.split(/\r?\n/, 1)[0] : '' } : null;

  return <div className="discussion-thread" data-thread-id={threadId} data-focus-message-id={focusMessageId}>
    <header className="discussion-thread__header">
      <Text variant="headline">{state.title || 'Обсуждение'}</Text>
      <IconButton icon="x" label="Закрыть обсуждение" onClick={onClose} />
    </header>
    <div className="discussion-thread__scroll" ref={scroller} style={{ paddingBottom: composerHeight + contextHeight + 16 }}
      onScroll={event => { const el = event.currentTarget; setAtEnd(el.scrollHeight - el.scrollTop - el.clientHeight < 48); closeMenu(); }}>
      {state.error && <div role="alert"><Text>{state.error}</Text><Button rounded onClick={session.retry}>Повторить</Button></div>}
      {state.more && <Button rounded disabled={state.loading} onClick={() => {
        const el = scroller.current;
        if (el) preserveScroll.current = { height: el.scrollHeight, top: el.scrollTop };
        session.loadMore();
      }}>Загрузить ещё</Button>}
      {state.loading && <Text variant="caption" role="status">Загрузка сообщений…</Text>}
      <Messages>
        {state.messages.map((message, index) => {
          const author = resolveAuthor(message.authorUserId);
          const day = message.createdAt.slice(0, 10);
          return <Fragment key={message.id}>
            {(index === 0 || state.messages[index - 1].createdAt.slice(0, 10) !== day) && <MessagesTitle>{new Date(message.createdAt).toLocaleDateString('ru-RU')}</MessagesTitle>}
            <div className="discussion-message-target" data-message-id={message.id} data-highlighted={highlight === message.id || undefined}
              ref={el => { if (el) rows.current.set(message.id, el); else rows.current.delete(message.id); }}>
              <MezfitMessage type={message.authorUserId === repository.actorUserId ? 'sent' : 'received'}
                name={<Text variant="caption">{author.name}</Text>}
                avatar={<Avatar name={author.name} src={author.avatarSrc} size="small" />}
                text={<Text variant="body" className="discussion-message-text">{message.deleted ? 'Сообщение удалено' : message.text}</Text>}
                textHeader={message.reply && <Quote quote={message.reply} resolveAuthor={resolveAuthor} onJump={() => { if (message.reply) void jump(message.reply.messageId); }} />}
                textFooter={!message.deleted && renderAttachment?.(message)}
                footer={<Text variant="caption">{new Date(message.createdAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}{message.editedAt ? ' · изменено' : ''}</Text>}
                onBubbleClick={() => { if (!message.deleted && !busy) setMenu({ id: message.id, open: true }); }}
                bubbleSource={menu?.id === message.id && <span onClick={event => event.stopPropagation()}><LiquidPopover key={message.id} triggerRef={trigger}
                  triggerActivation="controlled" isOpen={menu.open} onOpenChange={open => setMenu(current => current?.id === message.id ? { ...current, open } : current)}
                  onPresentationChange={presented => { if (!presented) setMenu(current => current?.id === message.id && !current.open ? null : current); }}
                  layout="menu" label="Действия сообщения" items={items} {...(glassSettings ?? loadBrowserGlassSettings())}
                  trigger={<button type="button" ref={trigger} aria-hidden="true" tabIndex={-1} className="discussion-menu-source" />} /></span>}
              />
            </div>
          </Fragment>;
        })}
      </Messages>
    </div>
    <div className="discussion-composer-context" ref={context} style={{ bottom: composerHeight }}>
      {error && <Text variant="footnote" role="alert">{error}</Text>}
      {syncState && <Text variant="caption" role="status">{syncState.status === 'synced' ? 'Синхронизировано'
        : syncState.status === 'error' ? 'Ошибка синхронизации' : syncState.offline ? 'Локально · нет сети' : 'Сохранено локально'}</Text>}
      {syncState?.status === 'error' && <Button rounded disabled={busy} onClick={() => void run(() => repository.sync.retry())}>Повторить синхронизацию</Button>}
      {(replyQuote || editId) && <div className="discussion-composer-context__mode">
        {replyQuote ? <Quote quote={replyQuote} resolveAuthor={resolveAuthor} onJump={() => void jump(replyQuote.messageId)} /> : <Text variant="footnote">Редактирование сообщения</Text>}
        <IconButton icon="x" label="Отменить ответ или редактирование" disabled={busy}
          onClick={() => { setReplyId(null); setEditId(null); if (editId) setText(''); }} />
      </div>}
    </div>
    <Messagebar ref={composer} textareaId={textareaId} placeholder={editId ? 'Редактировать сообщение' : 'Сообщение'} value={text}
      disabled={busy || !state.title || Boolean(state.error)} onChange={(event: ChangeEvent<HTMLTextAreaElement>) => setText(event.target.value)}
      right={<Button rounded strong disabled={busy || !text.trim() || !state.title || Boolean(state.error)} onClick={submit}>{editId ? 'Сохранить' : 'Отправить'}</Button>} />
    <MezfitDialog opened={Boolean(deletingId)} aria-hidden={deletingId ? undefined : true} inert={deletingId ? undefined : true}
      title={<Text variant="headline">Удалить сообщение?</Text>}
      content={<Text>Текст сообщения будет удалён.</Text>} onBackdropClick={() => { if (!busy) setDeletingId(null); }}
      buttons={<><MezfitDialogButton disabled={busy} onClick={() => setDeletingId(null)}><Text>Отмена</Text></MezfitDialogButton>
        <MezfitDialogButton strong tone="danger" disabled={busy} onClick={() => {
          const id = deletingId; if (!id) return;
          void run(async () => { await repository.remove(threadId, id); if (alive.current) setDeletingId(null); });
        }}><Text>Удалить</Text></MezfitDialogButton></>} />
  </div>;
}
