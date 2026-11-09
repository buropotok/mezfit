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
import { DISCUSSION_MEDIA_ACCEPT } from '../data/cloud/discussion-media';
import { directMediaUrl } from '../media/directMediaUpload';
import { DiscussionMedia } from './DiscussionMedia';
import { useDiscussionMedia } from './useDiscussionMedia';
import './discussion-sheet.css';

export interface DiscussionAuthor { name: string; avatarSrc?: string }
export interface DiscussionSheetProps extends DiscussionTarget {
  opened: boolean;
  repository: DiscussionPort;
  onClose: () => void;
  /** Entity integrations return Back directly to the source. */
  onBack?: () => void;
  resolveAuthor: (userId: string) => DiscussionAuthor;
  /** The existing shell remains the single owner of browser/Telegram Back. */
  onNavigationContextChange: (context: NavigationContext | null) => void;
  parentNavigation: NavigationContext | null;
  contextLabel?: string;
  /** Retain history when the exact source execution has been logically removed. */
  contextUnavailable?: boolean;
  /** Keep one sheet mounted while the entity repository resolves its canonical thread. */
  opening?: { error: string; retry: () => void };
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
    {props.opened && (props.opening ? <div className="discussion-thread">
      <header className="discussion-thread__header"><Text variant="headline">{props.contextLabel || 'Обсуждение'}</Text>
        <IconButton icon="x" label="Закрыть обсуждение" onClick={props.onClose} /></header>
      {props.contextUnavailable && <Text variant="footnote" role="status">Объект недоступен. История обсуждения сохранена.</Text>}
      {props.opening.error ? <div role="alert"><Text>{props.opening.error}</Text>
        <Button rounded onClick={props.opening.retry}>Повторить</Button></div>
        : <Text variant="footnote" role="status">Открываем переписку…</Text>}
    </div> : <OpenDiscussion key={identity} {...props} />)}
  </MezfitBottomSheet>;
}

function OpenDiscussion({ repository, threadId, anchor, focusMessageId, onClose, onBack, resolveAuthor,
  onNavigationContextChange, parentNavigation, contextLabel, contextUnavailable, glassSettings, showAvatars = false, renderAttachment }: DiscussionSheetProps) {
  const targetKey = JSON.stringify([threadId, anchor]);
  const session = useMemo(() => new DiscussionSession(repository, { threadId, anchor }), [repository, targetKey]);
  const state = useSyncExternalStore(session.subscribe, session.snapshot, session.snapshot);
  const draft = useDiscussionDraft(repository, threadId);
  const media = useDiscussionMedia(repository, draft);
  const gallery = useRef<HTMLInputElement>(null);
  const mediaBusy = media.phase !== 'idle' && media.phase !== 'failed';
  const mediaPresent = Boolean(media.selection || draft.media);
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
  const [receiptError, setReceiptError] = useState(false);
  const [receiptRetry, setReceiptRetry] = useState(0);
  const confirmationAttempts = useRef(new Set<string>());
  const material = glassSettings ?? loadBrowserGlassSettings();
  const [requestedFocus, setRequestedFocus] = useState<string | null>(null);
  const [highlight, setHighlight] = useState<string | null>(null);
  const [readPosition, setReadPosition] = useState(0);
  const [readError, setReadError] = useState(false);
  const [atEnd, setAtEnd] = useState(!focusMessageId);
  const [visible, setVisible] = useState(() => document.visibilityState !== 'hidden');
  const focusing = useRef(Boolean(focusMessageId));
  const [composerHeight, setComposerHeight] = useState(64);
  const [contextHeight, setContextHeight] = useState(0);
  const scroller = useRef<HTMLDivElement>(null), context = useRef<HTMLDivElement>(null);
  const composer = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null);
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
  const focusScrollCleanup = useRef<(() => void) | null>(null);
  const lastRead = useRef<string | null>(null), focusVersion = useRef(0);
  const back = useRef<() => void>(() => {});
  const textareaId = useId();

  useEffect(() => {
    alive.current = true; session.start();
    const sync = repository.sync.observe(value => { if (alive.current) setSyncState(value); });
    return () => { alive.current = false; ++actionVersion.current; ++focusVersion.current;
      session.stop(); sync.unsubscribe(); focusScrollCleanup.current?.(); };
  }, [session, repository]);
  useEffect(() => {
    if (!repository.observeReceipts) return;
    let active = true;
    const subscription = repository.observeReceipts(threadId, snapshot => {
      if (active && alive.current) { setReceipts(snapshot); setReceiptError(false); }
    }, () => {
      if (active && alive.current) setReceiptError(true);
    });
    return () => { active = false; subscription.unsubscribe(); };
  }, [repository, threadId, receiptRetry]);
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
    focusScrollCleanup.current?.();
    focusing.current = true;
    setAtEnd(false); setHighlight(null); setRequestedFocus(null); closeMenu();
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
    focusScrollCleanup.current?.();
    focusing.current = Boolean(focusMessageId); setHighlight(null); setRequestedFocus(null);
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
      const bounds = row.getBoundingClientRect();
      const target = Math.max(0, Math.min(list.scrollHeight - list.clientHeight,
        bounds.top - list.getBoundingClientRect().top + list.scrollTop - (list.clientHeight - bounds.height) / 2));
      const version = focusVersion.current;
      const pulse = () => {
        if (alive.current && focusVersion.current === version) setHighlight(requestedFocus);
      };
      // The native scroll belongs to this viewport. Start the one-second bubble
      // pulse only when its motion settles, never while the row is travelling.
      if (Math.abs(target - list.scrollTop) < 1 || typeof list.scrollTo !== 'function') {
        list.scrollTop = target;
        pulse();
      } else {
        let idleTimer: number | undefined;
        let fallbackTimer: number | undefined;
        let settled = false;
        const cleanup = () => {
          list.removeEventListener('scrollend', finish);
          list.removeEventListener('scroll', onScroll);
          window.clearTimeout(idleTimer);
          window.clearTimeout(fallbackTimer);
          if (focusScrollCleanup.current === cleanup) focusScrollCleanup.current = null;
        };
        const finish = () => {
          if (settled) return;
          settled = true;
          cleanup();
          pulse();
        };
        const onScroll = () => {
          window.clearTimeout(idleTimer);
          // Older WebViews lack scrollend; their last scroll event defines
          // the end of the smooth scroll.
          idleTimer = window.setTimeout(finish, 120);
        };
        list.addEventListener('scrollend', finish, { once: true });
        list.addEventListener('scroll', onScroll);
        focusScrollCleanup.current = cleanup;
        fallbackTimer = window.setTimeout(finish, 1600);
        list.scrollTo({ top: target, behavior: 'smooth' });
      }
      setRequestedFocus(null);
      preserveScroll.current = null;
    } else if (focusScrollCleanup.current) {
      // Avoid fighting the native smooth scroll with scroll-anchor corrections.
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
  const markViewed = (id: string) => {
    lastRead.current = id;
    void repository.markRead(threadId, id).then(() => {
      if (alive.current) setReadError(false);
    }, () => {
      if (alive.current) { lastRead.current = null; setReadError(true); }
    });
  };
  useEffect(() => {
    if (!visible || focusing.current || state.loading || state.error || requestedFocus) return;
    const list = scroller.current;
    const bounds = list?.getBoundingClientRect();
    const newest = [...state.messages].reverse().find(message => {
      if (message.deleted || message.authorUserId === repository.actorUserId) return false;
      if (atEnd) return true;
      const box = rows.current.get(message.id)?.getBoundingClientRect();
      return bounds && box && box.height > 0 && box.bottom > bounds.top
        && box.top < bounds.bottom - composerHeight - contextHeight;
    });
    if (!newest || lastRead.current === newest.id) return;
    markViewed(newest.id);
  }, [atEnd, visible, readPosition, state.messages, state.loading, state.error, requestedFocus, repository, threadId, composerHeight, contextHeight, syncState?.status, syncState?.offline]);

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
  const submit = () => {
    if (pending.current || mediaBusy) return;
    if (!editId && mediaPresent) { void media.send(); return; }
    void run(async () => {
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
  };
  const selected = menu ? state.messages.find(row => row.id === menu.id && !row.deleted) : undefined;
  const choose = (action: 'reply' | 'edit' | 'copy' | 'delete') => {
    if (!selected || !menuRef.current?.open || menuRef.current.id !== selected.id || pending.current || mediaBusy) return;
    const id = selected.id; closeMenu();
    const row = session.snapshot().messages.find(message => message.id === id && !message.deleted);
    if (!row) return;
    if (action === 'reply') {
      // Selecting Reply is an explicit viewing action even away from the end.
      if (row.authorUserId !== repository.actorUserId) markViewed(row.id);
      draft.update(draft.text, id); setEditId(null); setEditText('');
    }
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
    ...(own && selected?.text.trim() && !mediaPresent ? [{ id: 'edit', label: 'Редактировать', icon: 'edit' as const, onSelect: () => choose('edit') }] : []),
    ...(selected?.text.trim() ? [{ id: 'copy', label: 'Копировать', icon: 'copy' as const, onSelect: () => choose('copy') }] : []),
    ...(own ? [{ id: 'delete', label: 'Удалить', icon: 'trash' as const, onSelect: () => choose('delete') }] : []),
  ];
  const replying = replyId ? state.messages.find(row => row.id === replyId) : undefined;
  const replyQuote: DiscussionQuote | null = replyId ? { messageId: replyId,
    authorUserId: replying?.authorUserId ?? null, deleted: Boolean(replying?.deleted), unavailable: !replying,
    text: replying && !replying.deleted ? replying.text.split(/\r?\n/, 1)[0] : '' } : null;

  return <div className="discussion-thread" data-thread-id={threadId} data-focus-message-id={focusMessageId}
    data-show-avatars={String(showAvatars)}>
    <header className="discussion-thread__header">
      <div className="discussion-thread__identity">
        <div className="discussion-thread__title-row">
          <Text variant="headline" className="discussion-thread__title">{contextLabel || state.title || 'Обсуждение'}</Text>
          {repository.sourceKind === 'demo' && <Text variant="caption" tone="muted" className="discussion-thread__demo">Демо</Text>}
        </div>
        {contextUnavailable && <Text variant="footnote" role="status">Объект недоступен. История обсуждения сохранена.</Text>}
        {syncState && repository.sourceKind !== 'demo' && <Text variant="caption" role="status">{syncState.status === 'synced' ? 'Синхронизировано'
          : syncState.status === 'error' ? 'Ошибка синхронизации' : syncState.offline ? 'Локально · нет сети' : 'Сохранено локально'}</Text>}
      </div>
      <IconButton icon="x" label="Закрыть обсуждение" onClick={onClose} />
    </header>
    <div className="discussion-thread__scroll" ref={scroller} style={{ paddingBottom: composerHeight + contextHeight + 16 }}
      onScroll={event => { const el = event.currentTarget; setAtEnd(el.scrollHeight - el.scrollTop - el.clientHeight < 48); rememberPosition(); setReadPosition(value => value + 1); closeMenu(); }}>
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
          const isRead = isOwn && receipts.recipientReadThrough.some(cursor => (!cursor.threadId || cursor.threadId === message.threadId) && discussionCursorKey(cursor) >= cursorKey);
          const isConfirmed = isOwn && receipts.confirmedIds.includes(message.id);
          const receiptIcon = isRead ? 'message-double-check' : isConfirmed ? 'message-check' : null;
          const time = new Date(message.createdAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
          const day = new Date(message.createdAt).toLocaleDateString('ru-RU');
          return <Fragment key={message.id}>
            {(index === 0 || new Date(state.messages[index - 1].createdAt).toLocaleDateString('ru-RU') !== day) && <MessagesTitle>{day}</MessagesTitle>}
            <div className="discussion-message-target" data-message-id={message.id} data-own={String(isOwn)}
              data-highlighted={highlight === message.id || undefined}
              ref={el => { if (el) rows.current.set(message.id, el); else rows.current.delete(message.id); }}>
              <MezfitMessage type={isOwn ? 'sent' : 'received'} focusPulse={highlight === message.id}
                name={showAvatars && author ? <Text variant="caption">{author.name}</Text> : undefined}
                avatar={showAvatars && author ? <Avatar name={author.name} src={author.avatarSrc} size="small" /> : undefined}
                text={<Text variant="chat" className="discussion-message-text">{message.deleted ? 'Сообщение удалено' : message.text}</Text>}
                textHeader={message.reply && <Quote quote={message.reply} resolveAuthor={resolveAuthor} onJump={() => { if (message.reply) void jump(message.reply.messageId); }} />}
                textFooter={!message.deleted && (message.attachments?.length ? message.attachments.map(attachment => {
                  const src = attachment.storageKey && directMediaUrl(attachment.storageKey);
                  return src && attachment.mediaType !== 'voice'
                    ? <DiscussionMedia key={attachment.id} src={src} type={attachment.mediaType} /> : null;
                }) : renderAttachment?.(message))}
                inlineMeta={<span className="discussion-message-meta"><Text variant="caption">{time}</Text>
                  {receiptIcon && <span className="discussion-message-meta__check" role="img"
                    aria-label={isRead ? 'Прочитано собеседником' : 'Отправка подтверждена Dexie Cloud'}>
                    <Icon name={receiptIcon} /></span>}
                </span>}
                onBubbleClick={() => { if (!message.deleted && !pending.current && !mediaBusy) setMenu({ id: message.id, open: true }); }}
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
      {receiptError && <><Text variant="footnote" role="alert">Не удалось обновить статусы прочтения</Text>
        <Button rounded onClick={() => setReceiptRetry(value => value + 1)}>Повторить обновление статусов</Button></>}
      {readError && <><Text variant="footnote" role="alert">Не удалось отметить сообщения прочитанными</Text>
        <Button rounded onClick={() => setReadPosition(value => value + 1)}>Повторить отметку прочтения</Button></>}
      {error && <Text variant="footnote" role="alert">{error}</Text>}
      {media.error && <Text variant="footnote" role="alert">{media.error}</Text>}
      {media.phase === 'checking' && <Text variant="footnote" role="status">Проверяем файл…</Text>}
      {(mediaPresent || media.phase === 'uploading' || media.phase === 'publishing') && <div className="discussion-composer-context__mode">
        {media.preview && media.selection
          ? <DiscussionMedia key={media.preview} src={media.preview} type={media.selection.metadata.mediaType} preview />
          : <Text variant="footnote" className="discussion-media-filename">{draft.media?.fileName}</Text>}
        {media.phase === 'uploading' ? <>
          <Text variant="footnote" role="status">Загружаем вложение…</Text>
          <IconButton icon="x" label="Отменить загрузку" onClick={media.cancel} />
        </> : media.phase === 'publishing' ? <Text variant="footnote" role="status">Сохраняем сообщение…</Text> : <>
          {!media.selection && draft.media && <Button rounded disabled={busy || mediaBusy} onClick={() => gallery.current?.click()}>
            <Text variant="footnote">Выбрать файл снова</Text>
          </Button>}
          <IconButton icon="x" label="Убрать вложение" disabled={busy || mediaBusy} onClick={() => void media.remove()} />
        </>}
      </div>}
      {draft.error && <><Text variant="footnote" role="alert">{draft.error}</Text>
        <Button rounded disabled={busy} onClick={draft.retry}>Повторить сохранение черновика</Button></>}
      {syncState?.status === 'error' && <Button rounded disabled={busy} onClick={() => void run(() => repository.sync.retry())}>Повторить синхронизацию</Button>}
      {(replyQuote || editId) && <div className="discussion-composer-context__mode">
        {replyQuote ? <Quote quote={replyQuote} resolveAuthor={resolveAuthor} onJump={() => void jump(replyQuote.messageId)} /> : <Text variant="footnote">Редактирование сообщения</Text>}
        <IconButton icon="x" label="Отменить ответ или редактирование" disabled={busy || mediaBusy}
          onClick={cancelMode} />
      </div>}
    </div>
    <div className="discussion-composer" ref={composer}>
      <GlassSurface className="discussion-composer__button" {...material} shape="capsule" wrapContent={false}>
        {repository.supportsMedia && <input type="file" hidden ref={gallery} accept={DISCUSSION_MEDIA_ACCEPT}
          onChange={event => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = '';
            if (file) void media.choose(file);
          }} />}
        <IconButton icon="plus" label={repository.supportsMedia ? 'Добавить вложение' : 'Добавить вложение (пока недоступно)'}
          disabled={!repository.supportsMedia || busy || mediaBusy || mediaPresent || Boolean(editId) || !draft.ready || !state.title || Boolean(state.error)}
          onClick={() => gallery.current?.click()} />
      </GlassSurface>
      <GlassSurface className="discussion-composer__field" {...material} shape={{ radius: 24 }} wrapContent={false}>
        <MezfitMessagebar bare textareaId={textareaId} placeholder={editId ? 'Редактировать сообщение' : 'Сообщение'}
          value={text} maxRows={5} disabled={busy || mediaBusy || !draft.ready || !state.title || Boolean(state.error)}
          onChange={(event: ChangeEvent<HTMLTextAreaElement>) => setText(event.target.value)} />
      </GlassSurface>
      <GlassSurface className="discussion-composer__button" {...material} shape="capsule" wrapContent={false}>
        <IconButton icon={editId ? 'check' : 'arrow-up'} label={editId ? 'Сохранить' : media.phase === 'failed' && media.selection ? 'Повторить отправку' : 'Отправить'}
          disabled={busy || mediaBusy || !draft.ready || (mediaPresent ? !media.selection : !text.trim()) || !state.title || Boolean(state.error)} onClick={submit} />
      </GlassSurface>
    </div>
    <MezfitDialog opened={Boolean(deletingId)} aria-hidden={deletingId ? undefined : true} inert={deletingId ? undefined : true}
      title={<Text variant="headline">Удалить сообщение?</Text>}
      content={<Text>Сообщение будет удалено из переписки.</Text>} onBackdropClick={() => { if (!busy) setDeletingId(null); }}
      buttons={<><MezfitDialogButton disabled={busy} onClick={() => setDeletingId(null)}><Text>Отмена</Text></MezfitDialogButton>
        <MezfitDialogButton strong tone="danger" disabled={busy} onClick={() => {
          const id = deletingId; if (!id) return;
          void run(async () => { await repository.remove(threadId, id); if (alive.current) setDeletingId(null); });
        }}><Text>Удалить</Text></MezfitDialogButton></>} />
  </div>;
}
