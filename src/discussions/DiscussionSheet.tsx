import { Fragment, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ChangeEvent, type ReactNode } from 'react';
import { Button, Messages, MessagesTitle } from 'konsta/react';
import type { DiscussionMessageInput } from '../data/cloud/discussions';
import { discussionCursorKey, type DiscussionMessageView, type DiscussionQuote, type DiscussionReceiptSnapshot } from '../data/cloud/discussion-views';
import type { DiscussionSyncState } from '../data/cloud/discussion-sync';
import type { NavigationContext } from '../NavigationShell';
import { Avatar, IconButton, Text } from '../ui/primitives';
import { Icon } from '../ui/Icon';
import { GlassSurface } from '../ui/GlassSurface';
import { MezfitMessagebar } from '../ui/konsta-mezfit/Messagebar';
import { LiquidPopover, type LiquidPopoverItem } from '../ui/LiquidPopover';
import { MezfitBottomSheet } from '../ui/konsta-mezfit/BottomSheet';
import { MezfitMessage } from '../ui/konsta-mezfit/Message';
import { MezfitDialog, MezfitDialogButton } from '../ui/konsta-mezfit/Dialog';
import { loadBrowserGlassSettings, type GlassSettings } from '../glassSettings';
import { DiscussionSession, type DiscussionPort, type DiscussionTarget } from './discussion-session';
import { useDiscussionViewport } from './useDiscussionViewport';
import { useDiscussionDraft } from './useDiscussionDraft';
import './discussion-sheet.css';

export interface DiscussionAuthor { name: string; avatarSrc?: string }
export interface DiscussionSheetProps extends DiscussionTarget {
  opened: boolean;
  repository: DiscussionPort;
  onClose: () => void;
  /** Entity integrations may return Back to their thread list; Close still returns to the entity. */
  onBack?: () => void;
  resolveAuthor: (userId: string) => DiscussionAuthor;
  /** The existing shell remains the single owner of browser/Telegram Back. */
  onNavigationContextChange: (context: NavigationContext | null) => void;
  parentNavigation: NavigationContext | null;
  contextLabel?: string;
  onOpenContext?: () => void;
  glassSettings?: GlassSettings;
  /** Compact direct conversation by default; retain native author presentation for groups. */
  showAvatars?: boolean;
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

function OpenDiscussion({ repository, threadId, anchor, focusMessageId, onClose, onBack, resolveAuthor,
  onNavigationContextChange, parentNavigation, contextLabel, onOpenContext, glassSettings, showAvatars = false, renderAttachment }: DiscussionSheetProps) {
  const targetKey = JSON.stringify([threadId, anchor]);
  const session = useMemo(() => new DiscussionSession(repository, { threadId, anchor }), [repository, targetKey]);
  const state = useSyncExternalStore(session.subscribe, session.snapshot, session.snapshot);
  const draft = useDiscussionDraft(repository, threadId);
  const [editText, setEditText] = useState('');
  const [editId, setEditId] = useState<string | null>(null);
  const replyId = editId ? null : draft.replyId;
  const text = editId ? editText : draft.text;
  const setText = (value: string) => { if (editId) setEditText(value); else draft.update(value, replyId); };
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ id: string; open: boolean } | null>(null);
  const menuRef = useRef(menu);
  menuRef.current = menu;
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [syncState, setSyncState] = useState<DiscussionSyncState | null>(null);
  const [receipts, setReceipts] = useState<DiscussionReceiptSnapshot>({ confirmedIds: [], recipientReadThrough: [] });
  const confirmationAttempts = useRef(new Set<string>());
  const material = glassSettings ?? loadBrowserGlassSettings();
  const [requestedFocus, setRequestedFocus] = useState<string | null>(null);
  const [highlight, setHighlight] = useState<string | null>(null);
  const [atEnd, setAtEnd] = useState(!focusMessageId);
  const [visible, setVisible] = useState(() => document.visibilityState !== 'hidden');
  const focusing = useRef(Boolean(focusMessageId));
  const [composerHeight, setComposerHeight] = useState(64);
  const [contextHeight, setContextHeight] = useState(0);
  const scroller = useRef<HTMLDivElement>(null), context = useRef<HTMLDivElement>(null);
  const composer = useRef<HTMLElement>(null), trigger = useRef<HTMLButtonElement>(null);
  const rows = useRef(new Map<string, HTMLDivElement>());
  const alive = useRef(false), pending = useRef(false), actionVersion = useRef(0);
  const prepared = useRef<DiscussionMessageInput | null>(null);
  const preserveScroll = useRef<{ height: number; top: number } | null>(null);
  const readingPosition = useRef<{ id: string; offset: number } | null>(null);
  const rememberPosition = () => {
    const list = scroller.current;
    if (!list) return;
    const bounds = list.getBoundingClientRect();
    for (const [id, row] of rows.current) {
      const box = row.getBoundingClientRect();
      if (box.height > 0 && box.bottom > bounds.top && box.top < bounds.bottom) {
        readingPosition.current = { id, offset: box.top - bounds.top }; return;
      }
    }
    readingPosition.current = null;
  };
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
  useEffect(() => {
    if (!repository.observeReceipts) return;
    const subscription = repository.observeReceipts(threadId, snapshot => {
      if (alive.current) setReceipts(snapshot);
    }, () => {
      if (alive.current) setReceipts({ confirmedIds: [], recipientReadThrough: [] });
    });
    return () => subscription.unsubscribe();
  }, [repository, threadId]);
  useEffect(() => {
    // A general Addon in-sync flag never becomes a receipt. Ask the repository
    // to await a push for exactly the currently visible own message IDs.
    if (!repository.confirmDelivery || !syncState || syncState.offline || syncState.status === 'error') return;
    const ids = state.messages.filter(message => message.authorUserId === repository.actorUserId
      && !message.deleted && !receipts.confirmedIds.includes(message.id)
      && !confirmationAttempts.current.has(message.id)).map(message => message.id);
    if (!ids.length) return;
    for (const id of ids) confirmationAttempts.current.add(id);
    void repository.confirmDelivery(threadId, ids).catch(() => {
      for (const id of ids) confirmationAttempts.current.delete(id);
      // Offline/failure remains unconfirmed until the next observed sync state change.
    });
  }, [repository, threadId, state.messages, receipts.confirmedIds, syncState?.offline, syncState?.status]);
  const closeMenu = () => {
    if (!menuRef.current?.open) return;
    menuRef.current = { ...menuRef.current, open: false };
    setMenu(menuRef.current);
  };
  const cancelMode = () => { if (!editId) draft.update(draft.text, null); setEditId(null); setEditText(''); };
  back.current = () => {
    if (deletingId) { setDeletingId(null); return; }
    if (menu?.open) { closeMenu(); return; }
    if (replyId || editId) { cancelMode(); return; }
    (onBack ?? onClose)();
  };
  useEffect(() => {
    // Preserve the underlying entity and its scroll identity; no independent history/Back listeners.
    onNavigationContextChange({ ...parentNavigation, title: parentNavigation?.title ?? 'Обсуждение',
      onBack: () => back.current() });
    return () => onNavigationContextChange(parentNavigation);
  }, [onNavigationContextChange, parentNavigation, session]);
  useEffect(() => {
    const update = () => setVisible(document.visibilityState !== 'hidden');
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, []);

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
  }, [replyId, editId, error, draft.error, syncState?.status, syncState?.offline]);

  const jump = async (id: string) => {
    const version = ++focusVersion.current;
    focusing.current = true;
    setAtEnd(false); setRequestedFocus(null); closeMenu();
    try {
      const found = await session.locate(id);
      if (alive.current && version === focusVersion.current) {
        if (found) setRequestedFocus(id);
        else setError('Исходное сообщение недоступно');
      }
    } catch { if (alive.current && version === focusVersion.current) {
      setRequestedFocus(null); setError('Не удалось перейти к сообщению');
    } } finally { if (version === focusVersion.current) focusing.current = false; }
  };
  const deepFocus = useRef<string | null>(null);
  useEffect(() => {
    ++focusVersion.current; session.cancelLocate(); deepFocus.current = null;
    focusing.current = Boolean(focusMessageId); setRequestedFocus(null);
    if (focusMessageId) setAtEnd(false);
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
    } else if (!atEnd && readingPosition.current && rows.current.has(readingPosition.current.id)) {
      const row = rows.current.get(readingPosition.current.id);
      if (row) list.scrollTop += row.getBoundingClientRect().top - list.getBoundingClientRect().top - readingPosition.current.offset;
      preserveScroll.current = null;
    } else if (preserveScroll.current) {
      list.scrollTop = preserveScroll.current.top + list.scrollHeight - preserveScroll.current.height;
      preserveScroll.current = null;
    } else if (atEnd) list.scrollTop = list.scrollHeight;
    rememberPosition();
  }, [state.messages, requestedFocus, atEnd, composerHeight, contextHeight]);
  useEffect(() => {
    if (!atEnd || !visible || focusing.current || state.loading || state.error || requestedFocus) return;
    const newest = [...state.messages].reverse().find(message => !message.deleted && message.authorUserId !== repository.actorUserId);
    if (!newest || lastRead.current === newest.id) return;
    lastRead.current = newest.id;
    void repository.markRead(threadId, newest.id).catch(() => {
      if (alive.current) { lastRead.current = null; setError('Не удалось отметить сообщения прочитанными'); }
    });
  }, [atEnd, visible, state.messages, state.loading, state.error, requestedFocus, repository, threadId]);

  useEffect(() => {
    if (menu && !state.messages.some(row => row.id === menu.id && !row.deleted)) setMenu(null);
    if (editId && state.messages.some(row => row.id === editId && row.deleted)) {
      setEditId(null); setEditText(''); setError('Сообщение уже удалено');
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
      const command = draft.command();
      if (!prepared.current || prepared.current.id !== command.id || prepared.current.text !== text
        || prepared.current.replyToMessageId !== (replyId ?? undefined)) prepared.current = command;
      const submitted = prepared.current;
      try {
        await repository.send(submitted);
        draft.sent(submitted.id);
      } catch (reason) {
        if (reason instanceof Error && (reason.message === 'DISCUSSION_DRAFT_ALREADY_PUBLISHED'
          || reason.message === 'DISCUSSION_ID_REUSED')) {
          draft.rebase(submitted.id); prepared.current = null;
        }
        throw reason;
      }
    }
    if (alive.current) { prepared.current = null; setEditText(''); setEditId(null); }
  });
  const selected = menu ? state.messages.find(row => row.id === menu.id && !row.deleted) : undefined;
  const choose = (action: 'reply' | 'edit' | 'copy' | 'delete') => {
    if (!selected || !menuRef.current?.open || menuRef.current.id !== selected.id || pending.current) return;
    const id = selected.id; closeMenu();
    const row = session.snapshot().messages.find(message => message.id === id && !message.deleted);
    if (!row) return;
    if (action === 'reply') { draft.update(draft.text, id); setEditId(null); setEditText(''); }
    if (action === 'edit' && row.authorUserId === repository.actorUserId) { setEditId(id); setEditText(row.text); }
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

  return <div className="discussion-thread" data-thread-id={threadId} data-focus-message-id={focusMessageId}
    data-show-avatars={String(showAvatars)}>
    <header className="discussion-thread__header">
      <Text variant="headline">{state.title || 'Обсуждение'}</Text>
      <IconButton icon="x" label="Закрыть обсуждение" onClick={onClose} />
    </header>
    <div className="discussion-thread__scroll" ref={scroller} style={{ paddingBottom: composerHeight + contextHeight + 16 }}
      onScroll={event => { const el = event.currentTarget; setAtEnd(el.scrollHeight - el.scrollTop - el.clientHeight < 48); rememberPosition(); closeMenu(); }}>
      {onOpenContext && <Button rounded tonal onClick={onOpenContext}><Text>{contextLabel || 'Вернуться к объекту'}</Text></Button>}
      {state.error && <div role="alert"><Text>{state.error}</Text><Button rounded onClick={() => { setError(null); deepFocus.current = null; session.retry(); }}>Повторить</Button></div>}
      {state.more && <Button rounded disabled={state.loading || Boolean(state.error)} onClick={() => {
        const el = scroller.current;
        if (el) preserveScroll.current = { height: el.scrollHeight, top: el.scrollTop };
        session.loadMore();
      }}>Загрузить ещё</Button>}
      {state.loading && <Text variant="caption" role="status">Загрузка сообщений…</Text>}
      <Messages>
        {state.messages.map((message, index) => {
          const author = showAvatars ? resolveAuthor(message.authorUserId) : null;
          const isOwn = message.authorUserId === repository.actorUserId;
          const cursorKey = discussionCursorKey({ id: message.id, createdAt: message.createdAt });
          const isRead = isOwn && receipts.recipientReadThrough.some(cursor => discussionCursorKey(cursor) >= cursorKey);
          const isConfirmed = isOwn && receipts.confirmedIds.includes(message.id);
          const receiptIcon = isRead ? 'message-double-check' : isConfirmed ? 'message-check' : null;
          const time = new Date(message.createdAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
          const day = new Date(message.createdAt).toLocaleDateString('ru-RU');
          return <Fragment key={message.id}>
            {(index === 0 || new Date(state.messages[index - 1].createdAt).toLocaleDateString('ru-RU') !== day) && <MessagesTitle>{day}</MessagesTitle>}
            <div className="discussion-message-target" data-message-id={message.id} data-own={String(isOwn)}
              data-highlighted={highlight === message.id || undefined}
              ref={el => { if (el) rows.current.set(message.id, el); else rows.current.delete(message.id); }}>
              <MezfitMessage type={isOwn ? 'sent' : 'received'}
                name={showAvatars && author ? <Text variant="caption">{author.name}</Text> : undefined}
                avatar={showAvatars && author ? <Avatar name={author.name} src={author.avatarSrc} size="small" /> : undefined}
                text={<Text variant="body" className="discussion-message-text">{message.deleted ? 'Сообщение удалено' : message.text}</Text>}
                textHeader={message.reply && <Quote quote={message.reply} resolveAuthor={resolveAuthor} onJump={() => { if (message.reply) void jump(message.reply.messageId); }} />}
                textFooter={!message.deleted && renderAttachment?.(message)}
                inlineMeta={<span className="discussion-message-meta"><Text variant="caption">{time}</Text>
                  {receiptIcon && <span className="discussion-message-meta__check" role="img"
                    aria-label={isRead ? 'Прочитано собеседником' : 'Отправка подтверждена Dexie Cloud'}>
                    <Icon name={receiptIcon} /></span>}
                </span>}
                onBubbleClick={() => { if (!message.deleted && !pending.current) setMenu({ id: message.id, open: true }); }}
                bubbleSource={menu?.id === message.id && <span onClick={event => event.stopPropagation()}><LiquidPopover key={message.id} triggerRef={trigger}
                  triggerActivation="controlled" isOpen={menu.open} onOpenChange={open => {
                    if (menuRef.current?.id !== message.id) return;
                    menuRef.current = { ...menuRef.current, open }; setMenu(menuRef.current);
                  }}
                  onPresentationChange={presented => { if (!presented) setMenu(current => current?.id === message.id && !current.open ? null : current); }}
                  layout="menu" label="Действия сообщения" items={items} {...material}
                  trigger={<button type="button" ref={trigger} aria-hidden="true" tabIndex={-1} className="discussion-menu-source" />} /></span>}
              />
            </div>
          </Fragment>;
        })}
      </Messages>
    </div>
    <div className="discussion-composer-context" ref={context} style={{ bottom: composerHeight }}>
      {error && <Text variant="footnote" role="alert">{error}</Text>}
      {draft.error && <><Text variant="footnote" role="alert">{draft.error}</Text>
        <Button rounded disabled={busy} onClick={draft.retry}>Повторить сохранение черновика</Button></>}
      {syncState && <Text variant="caption" role="status">{repository.sourceKind === 'demo' ? 'Демо' : syncState.status === 'synced' ? 'Синхронизировано'
        : syncState.status === 'error' ? 'Ошибка синхронизации' : syncState.offline ? 'Локально · нет сети' : 'Сохранено локально'}</Text>}
      {syncState?.status === 'error' && <Button rounded disabled={busy} onClick={() => void run(() => repository.sync.retry())}>Повторить синхронизацию</Button>}
      {(replyQuote || editId) && <div className="discussion-composer-context__mode">
        {replyQuote ? <Quote quote={replyQuote} resolveAuthor={resolveAuthor} onJump={() => void jump(replyQuote.messageId)} /> : <Text variant="footnote">Редактирование сообщения</Text>}
        <IconButton icon="x" label="Отменить ответ или редактирование" disabled={busy}
          onClick={cancelMode} />
      </div>}
    </div>
    <GlassSurface className="discussion-composer-surface" {...material}
      style={{ position: 'absolute', zIndex: 4, insetInline: 0, bottom: 0, width: '100%' }}>
      <MezfitMessagebar ref={composer} textareaId={textareaId} placeholder={editId ? 'Редактировать сообщение' : 'Сообщение'}
        value={text} maxRows={5} disabled={busy || !draft.ready || !state.title || Boolean(state.error)}
        onChange={(event: ChangeEvent<HTMLTextAreaElement>) => setText(event.target.value)}
        left={<IconButton icon="plus" label="Добавить вложение (пока недоступно)" disabled />}
        right={<IconButton icon={editId ? 'check' : 'arrow-up'} label={editId ? 'Сохранить' : 'Отправить'}
          disabled={busy || !draft.ready || !text.trim() || !state.title || Boolean(state.error)} onClick={submit} />}
      />
    </GlassSurface>
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
