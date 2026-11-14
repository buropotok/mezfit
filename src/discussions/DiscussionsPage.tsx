import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button } from 'konsta/react';
import type { NavigationContext } from '../NavigationShell';
import { useNavigationSurfaceContext } from '../navigation/NavigationSurfaceContext';
import { useCloudConnections } from '../data/cloud/CloudConnectionsProvider';
import { DiscussionRepository, observeDiscussionNotificationThread } from '../data/cloud/discussions';
import { CloudContactAvatar } from '../contacts/CloudContactAvatar';
import { Avatar, Badge, DatePicker, Icon, List, ListItem, Text, type LocalDate } from '../ui';
import { DiscussionSheet } from './DiscussionSheet';
import { DiscussionEntity } from './DiscussionEntity';
import { useDiscussions, type DiscussionInboxRow } from './DiscussionsProvider';
import { discussionDateLabel, discussionLocalDate, groupDiscussionFeed } from './feed-presentation';
import { ScheduleClientFilter } from '../schedule/ScheduleClientFilter';
import { ScheduleFilterBar } from '../schedule/ScheduleFilterBar';
import type { DiscussionAnchor } from '../../shared/discussion-anchor';
import './discussions-page.css';

const entityActionLabels = {
  program: 'К программе', workout: 'К тренировке', exercise: 'К упражнению', set: 'К подходу',
} satisfies Record<DiscussionAnchor['kind'], string>;

/** List actions are siblings through ListItem.trailingAction, never nested buttons. */
export function DiscussionInboxList({ rows, onOpen, onEntity }: {
  rows: readonly DiscussionInboxRow[]; onOpen: (row: DiscussionInboxRow) => void; onEntity: (row: DiscussionInboxRow) => void;
}) {
  return <>{groupDiscussionFeed(rows).map(group => <section className="discussion-inbox__group" key={group.date} aria-label={group.date || 'Без сообщений'}>
    <Text variant="footnote">{group.date ? discussionDateLabel(group.date) : 'Без сообщений'}</Text>
    <List divider="full">{group.rows.map(row => <ListItem key={row.thread.id}
      leading={row.contact ? <CloudContactAvatar contact={row.contact} /> : <Avatar name="Вы" />}
      title={<Text>{row.contact?.displayName ?? 'Личное обсуждение'}</Text>}
      subtitle={<span className="discussion-inbox__copy">
        <Text variant="caption" className="discussion-inbox__ellipsis">{row.thread.derivedTitleSnapshot}</Text>
        <Text variant="footnote" className="discussion-inbox__ellipsis">{row.latest?.text || (row.latest ? 'Вложение' : 'Сообщений пока нет')}</Text>
        {row.latest ? <Text variant="caption"><time dateTime={row.latest.createdAt}>{new Date(row.latest.createdAt).toLocaleString('ru-RU', {
          day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
        })}</time></Text> : null}
      </span>}
      trailing={<span className="discussion-inbox__indicators">
        {row.hasAttachments ? <span role="img" aria-label="Есть вложения" style={{ width: 16, height: 16 }}><Icon name="paperclip" /></span> : null}
        {row.unread > 0 ? <Badge color="blue" textVariant="caption" aria-label={`Непрочитанных: ${row.unread}`}>{row.unread}</Badge> : null}
      </span>}
      aria-label={`Обсуждение: ${row.contact?.displayName ?? 'Вы'}, ${row.thread.derivedTitleSnapshot}`}
      onClick={() => onOpen(row)}
      trailingAction={<Button rounded tonal inline
        aria-label={`${entityActionLabels[row.thread.anchor.kind]}: ${row.thread.derivedTitleSnapshot}`}
        onClick={() => onEntity(row)}><Text variant="caption">{entityActionLabels[row.thread.anchor.kind]}</Text></Button>} />)}</List>
  </section>)}</>;
}

export function DiscussionsPage({ role, relationshipId, notificationMessageId, onNotificationOpened, onNavigationContextChange }: {
  role: 'coach' | 'client'; relationshipId?: string;
  notificationMessageId?: string | null; onNotificationOpened?: () => void;
  onNavigationContextChange: (value: NavigationContext | null) => void;
}) {
  const cloud = useCloudConnections();
  const inbox = useDiscussions();
  const parent = useNavigationSurfaceContext();
  const notificationParent = useRef(parent);
  notificationParent.current = parent;
  const [clientUserIds, setClientUserIds] = useState<string[]>([]);
  const [clientFilter, setClientFilter] = useState<{ parent: NavigationContext | null } | null>(null);
  const clients = useMemo(() => [...new Map((cloud?.clients ?? []).map(contact => [contact.userId, contact])).values()], [cloud?.clients]);
  const closeClientFilter = useCallback(() => setClientFilter(null), []);
  const [from, setFrom] = useState<LocalDate | null>(null);
  const [to, setTo] = useState<LocalDate | null>(null);
  const [picker, setPicker] = useState<{ side: 'from' | 'to'; parent: NavigationContext | null } | null>(null);
  const [limit, setLimit] = useState(50);
  const [openError, setOpenError] = useState('');
  const [notificationRetry, setNotificationRetry] = useState(0);
  const notificationSyncPending = useRef(false);
  const request = useRef(0);
  const cancelPendingOpen = useCallback(() => {
    ++request.current;
    // An explicit tap in the inbox takes precedence over an unresolved deep link.
    if (notificationMessageId) onNotificationOpened?.();
  }, [notificationMessageId, onNotificationOpened]);
  const [opened, setOpened] = useState<{ row: DiscussionInboxRow; kind: 'chat' | 'entity' | 'notification'; parent: NavigationContext | null; messageId?: string } | null>(null);
  const activeRow = opened ? inbox.rows.find(row => row.thread.anchorKey === opened.row.thread.anchorKey
    && row.thread.realmId === opened.row.thread.realmId) : undefined;
  const notificationPeers = role === 'coach' ? cloud?.clients : cloud?.coaches;
  const notificationContact = opened?.kind === 'notification' ? notificationPeers?.find(
    contact => contact.relationshipId === opened.row.thread.realmId,
  ) : undefined;
  const current = (opened?.kind === 'notification' ? notificationContact : activeRow) ? opened : null;
  const [closedNotificationChat, setClosedNotificationChat] = useState(false);
  const [notificationEntityContext, setNotificationEntityContext] = useState<NavigationContext | null>(null);
  const [notificationChatContext, setNotificationChatContext] = useState<NavigationContext | null>(null);
  const activeNotification = current?.kind === 'notification';
  useEffect(() => {
    if (!activeNotification) return;
    onNavigationContextChange((!closedNotificationChat && notificationChatContext) || notificationEntityContext);
  }, [activeNotification, closedNotificationChat, notificationChatContext, notificationEntityContext, onNavigationContextChange]);
  useEffect(() => {
    if (activeNotification) return () => onNavigationContextChange(null);
  }, [activeNotification, onNavigationContextChange]);
  const openRef = useRef(false);
  openRef.current = Boolean(current);
  useEffect(() => () => { openRef.current = false; ++request.current; }, []);
  const close = useCallback(() => { ++request.current; openRef.current = false; setOpened(null); }, []);
  const closePicker = useCallback(() => setPicker(null), []);
  const repository = useMemo(() => {
    if (!cloud || !current || current.kind === 'entity') return null;
    try { return new DiscussionRepository(cloud.db, cloud.actorUserId, current.row.thread); }
    catch { return null; }
  }, [cloud?.db, cloud?.actorUserId, current]);
  const notificationRealmsKey = JSON.stringify((notificationPeers ?? []).map(contact => contact.relationshipId).sort());
  const db = cloud?.db;
  const actorId = cloud?.actorUserId;
  const canResolveNotification = cloud?.status === 'ready';
  useEffect(() => {
    if (!notificationMessageId || !db || !actorId || !canResolveNotification) return;
    const generation = ++request.current;
    const allowed = new Set<string>(JSON.parse(notificationRealmsKey));
    let subscription: { unsubscribe(): void } | null = null;
    let retryTimer: number | undefined;
    let failures = 0;
    let cancelled = false;
    setOpenError('');

    // An Addon "synced" snapshot is not proof that a freshly notified message
    // has already reached IndexedDB. The observer stays active even after this hint.
    const pendingTimer = window.setTimeout(() => {
      if (!cancelled && generation === request.current) {
        setOpenError('Обсуждение пока не загрузилось. Проверьте соединение и повторите попытку.');
      }
    }, 15_000);

    const observe = () => {
      if (cancelled || generation !== request.current) return;
      subscription = observeDiscussionNotificationThread(db, actorId, notificationMessageId, allowed,
        thread => {
          if (cancelled || generation !== request.current || !thread) return;
          ++request.current;
          subscription?.unsubscribe();
          window.clearTimeout(pendingTimer);
          setOpenError('');
          setClosedNotificationChat(false);
          setNotificationChatContext(null);
          setNotificationEntityContext(null);
          setOpened({ row: { thread, contact: null, latest: null, unread: 0, hasAttachments: false },
            kind: 'notification', parent: notificationParent.current, messageId: notificationMessageId });
          onNotificationOpened?.();
        },
        () => {
          if (cancelled || generation !== request.current) return;
          if (failures++ < 2) {
            // Unexpected local-read errors are terminal for liveQuery. Restore its
            // subscription after a short backoff, without clearing the deep link.
            retryTimer = window.setTimeout(observe, 1_000 * failures);
          } else {
            window.clearTimeout(pendingTimer);
            setOpenError('Не удалось загрузить обсуждение. Повторите попытку.');
          }
        });
    };
    observe();
    return () => {
      cancelled = true;
      window.clearTimeout(pendingTimer);
      if (retryTimer !== undefined) window.clearTimeout(retryTimer);
      subscription?.unsubscribe();
    };
  }, [notificationMessageId, db, actorId, notificationRealmsKey, canResolveNotification,
    notificationRetry, onNotificationOpened]);
  const retryNotification = useCallback(() => {
    if (!cloud || notificationSyncPending.current) return;
    notificationSyncPending.current = true;
    setOpenError('');
    setNotificationRetry(value => value + 1);
    // Connection provider owns the sync error; prevent parallel pull requests.
    void cloud.retrySync().catch(() => {}).finally(() => {
      notificationSyncPending.current = false;
    });
  }, [cloud]);
  const closeNotificationChat = useCallback(() => setClosedNotificationChat(true), []);
  const chatParent = useMemo<NavigationContext | null>(() => current
    ? { ...current.parent, level: 2, title: current.row.thread.derivedTitleSnapshot,
      onBack: current.kind === 'notification' ? closeNotificationChat : close } : null,
  [current, close, closeNotificationChat]);
  const chatNavigation = useCallback((value: NavigationContext | null) => {
    onNavigationContextChange(openRef.current ? value : null);
  }, [onNavigationContextChange]);
  useEffect(() => {
    if (!picker) return;
    onNavigationContextChange({ ...picker.parent, title: 'Период обсуждений', level: 2, onBack: closePicker });
    return () => onNavigationContextChange(picker.parent);
  }, [picker, closePicker, onNavigationContextChange]);
  useEffect(() => {
    if (!clientFilter) return;
    onNavigationContextChange({ ...clientFilter.parent, title: 'Фильтр по клиентам', level: 2, onBack: closeClientFilter });
    return () => onNavigationContextChange(clientFilter.parent);
  }, [clientFilter, closeClientFilter, onNavigationContextChange]);
  // Refresh Today/Yesterday headings across local midnight/resume without touching persistence.
  const [, setClock] = useState(0);
  useEffect(() => {
    const tick = () => setClock(value => value + 1);
    const timer = window.setInterval(tick, 60_000);
    document.addEventListener('visibilitychange', tick);
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', tick); };
  }, []);
  const openChat = async (row: DiscussionInboxRow) => {
    if (!cloud) return;
    cancelPendingOpen();
    const generation = request.current;
    setOpenError('');
    try {
      // Entity entry points use the same idempotent operation. Historical headers
      // stay intact; the canonical sheet projects them as one conversation.
      const repository = new DiscussionRepository(cloud.db, cloud.actorUserId, row.thread);
      const thread = await repository.ensureEntityThread(row.thread.anchor, row.thread.derivedTitleSnapshot);
      if (generation === request.current) setOpened({ row: { ...row, thread }, kind: 'chat', parent });
    } catch {
      if (generation === request.current) setOpenError('Не удалось открыть обсуждение. Повторите нажатие.');
    }
  };
  const rows = inbox.rows.filter(row => {
    if (relationshipId && row.thread.coachClientId !== relationshipId) return false;
    if (!relationshipId && clientUserIds.length && !cloud?.clients.some(contact =>
      contact.relationshipId === row.thread.coachClientId && clientUserIds.includes(contact.userId))) return false;
    if (!from && !to) return true;
    if (!row.latest) return false;
    const date = discussionLocalDate(row.latest.createdAt);
    return (!from || date >= from) && (!to || date <= to);
  });
  if (current?.kind === 'notification') return <>
    <DiscussionEntity thread={current.row.thread} role={role}
      onBack={close} onNavigationContextChange={setNotificationEntityContext} />
    {!closedNotificationChat && repository && createPortal(<div className="navigation-overlay-root k-ios dark safe-areas">
      <DiscussionSheet opened repository={repository} threadId={current.row.thread.id} anchor={current.row.thread.anchor}
        focusMessageId={current.messageId} onClose={closeNotificationChat} onBack={closeNotificationChat}
        contextLabel={current.row.thread.derivedTitleSnapshot}
        parentNavigation={chatParent} onNavigationContextChange={setNotificationChatContext}
        resolveAuthor={id => ({ name: id === actorId ? 'Вы' : (notificationContact || activeRow?.contact)?.displayName ?? 'Участник обсуждения' })} />
    </div>, document.body)}
  </>;
  if (current?.kind === 'entity') return <DiscussionEntity thread={current.row.thread} role={role}
    onBack={close} onNavigationContextChange={onNavigationContextChange} />;
  return <section className="discussion-inbox" aria-label="Обсуждения">
    <div className="discussion-inbox__filter-block">
      {role === 'coach' && !relationshipId ? <div className={`discussion-inbox__client-filter${clientUserIds.length ? '' : ' discussion-inbox__client-filter--all'}`}>
        {!clientUserIds.length ? <Text variant="footnote" className="discussion-inbox__all-clients">Все клиенты</Text> : null}
        <ScheduleFilterBar placement="content" clients={clients} selected={clientUserIds}
          onOpen={() => { cancelPendingOpen(); setClientFilter({ parent }); }}
          onRemove={id => { cancelPendingOpen(); setClientUserIds(current => current.filter(value => value !== id)); setLimit(50); }} />
      </div> : null}
      <div className="discussion-inbox__filters">
        <Button rounded tonal inline onClick={() => { cancelPendingOpen(); setPicker({ side: 'from', parent }); }}><Text variant="footnote">{from ? `С ${discussionDateLabel(from)}` : 'С даты'}</Text></Button>
        <Button rounded tonal inline onClick={() => { cancelPendingOpen(); setPicker({ side: 'to', parent }); }}><Text variant="footnote">{to ? `По ${discussionDateLabel(to)}` : 'По дату'}</Text></Button>
        {from || to || clientUserIds.length ? <Button rounded clear inline onClick={() => { cancelPendingOpen(); setFrom(null); setTo(null); setClientUserIds([]); setLimit(50); }}><Text variant="footnote">Сбросить</Text></Button> : null}
      </div>
    </div>
    {from && to && from > to ? <Text variant="footnote" role="alert">Дата начала позже даты окончания</Text> : null}
    {cloud?.syncStatus === 'offline' ? <Text variant="caption">Нет соединения. Показаны обсуждения на устройстве.</Text>
      : cloud?.syncStatus === 'pending' ? <Text variant="caption">Синхронизируем обсуждения…</Text> : null}
    {cloud?.syncStatus === 'error' ? <Text variant="caption" role="status">Синхронизация прервана. Локальные обсуждения доступны.</Text> : null}
    {notificationMessageId && !opened && !openError ? <Text variant="footnote" role="status">Загружаем обсуждение по ссылке…</Text> : null}
    {openError ? <div className="stack"><Text role="alert">{openError}</Text>
      {notificationMessageId && !opened ? <Button rounded tonal onClick={retryNotification}><Text>Повторить</Text></Button> : null}
    </div> : null}
    {inbox.error ? <div className="stack"><Text role="alert">{inbox.error}</Text>
      <Button rounded tonal onClick={() => { cancelPendingOpen(); inbox.retry(); }}><Text>Повторить</Text></Button></div> : null}
    {cloud?.status === 'error' && !rows.length ? <Text role="status">{cloud.error}</Text> : null}
    {inbox.loading && !rows.length ? <Text>Загружаем обсуждения…</Text>
      : cloud?.status === 'ready' && !inbox.error && !rows.length ? <Text>{from || to || clientUserIds.length ? 'За выбранный период обсуждений нет' : 'Обсуждений пока нет'}</Text> : null}
    <DiscussionInboxList rows={rows.slice(0, limit)} onOpen={row => { void openChat(row); }}
      onEntity={row => { cancelPendingOpen(); setOpened({ row, kind: 'entity', parent }); }} />
    {rows.length > limit ? <Button rounded tonal onClick={() => { cancelPendingOpen(); setLimit(value => value + 50); }}><Text>Показать ещё</Text></Button> : null}
    {role === 'coach' && !relationshipId ? <ScheduleClientFilter opened={clientFilter !== null}
      clients={clients} loading={cloud?.status === 'loading'} selected={clientUserIds}
      onClose={closeClientFilter} onApply={ids => {
        cancelPendingOpen(); setClientUserIds(ids.filter(id => clients.some(contact => contact.userId === id)));
        setLimit(50); closeClientFilter();
      }} /> : null}
    <DatePicker opened={picker !== null} value={(picker?.side === 'to' ? to : from) ?? discussionLocalDate(new Date()) as LocalDate}
      onClose={closePicker} surface="panel" onChange={date => {
        if (picker?.side === 'from') setFrom(date); else setTo(date);
        setLimit(50); setPicker(null);
      }} />
    {current?.kind === 'chat' && repository && createPortal(<div className="navigation-overlay-root k-ios dark safe-areas">
      <DiscussionSheet opened repository={repository} threadId={current.row.thread.id} anchor={current.row.thread.anchor}
        onClose={close} onBack={close} contextLabel={current.row.thread.derivedTitleSnapshot}
        parentNavigation={chatParent} onNavigationContextChange={chatNavigation}
        resolveAuthor={id => ({ name: id === cloud?.actorUserId ? 'Вы' : activeRow?.contact?.displayName ?? 'Участник обсуждения' })} />
    </div>, document.body)}
  </section>;
}
