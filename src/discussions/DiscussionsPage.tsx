import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button } from 'konsta/react';
import type { NavigationContext } from '../NavigationShell';
import { useNavigationSurfaceContext } from '../navigation/NavigationSurfaceContext';
import { useCloudConnections } from '../data/cloud/CloudConnectionsProvider';
import { liveQuery } from 'dexie';
import { DiscussionRepository, readDiscussionNotificationThread } from '../data/cloud/discussions';
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
  const [clientUserIds, setClientUserIds] = useState<string[]>([]);
  const [clientFilter, setClientFilter] = useState<{ parent: NavigationContext | null } | null>(null);
  const clients = useMemo(() => [...new Map((cloud?.clients ?? []).map(contact => [contact.userId, contact])).values()], [cloud?.clients]);
  const closeClientFilter = useCallback(() => setClientFilter(null), []);
  const [from, setFrom] = useState<LocalDate | null>(null);
  const [to, setTo] = useState<LocalDate | null>(null);
  const [picker, setPicker] = useState<{ side: 'from' | 'to'; parent: NavigationContext | null } | null>(null);
  const [limit, setLimit] = useState(50);
  const [openError, setOpenError] = useState('');
  const request = useRef(0);
  const [opened, setOpened] = useState<{ row: DiscussionInboxRow; kind: 'chat' | 'entity' | 'notification'; parent: NavigationContext | null; messageId?: string } | null>(null);
  const activeRow = opened ? inbox.rows.find(row => row.thread.anchorKey === opened.row.thread.anchorKey
    && row.thread.realmId === opened.row.thread.realmId) : undefined;
  const notificationContact = opened?.kind === 'notification' ? cloud?.clients.find(
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
  const notificationRealmsKey = JSON.stringify((cloud?.clients ?? []).map(contact => contact.relationshipId).sort());
  const db = cloud?.db;
  const actorId = cloud?.actorUserId;
  const canResolveNotification = cloud?.status === 'ready';
  const notificationSynced = cloud?.syncStatus === 'synced';
  useEffect(() => {
    if (!notificationMessageId || !db || !actorId || !canResolveNotification) return;
    const generation = ++request.current;
    const allowed = new Set<string>(JSON.parse(notificationRealmsKey));
    const subscription = liveQuery(() => readDiscussionNotificationThread(db, actorId, notificationMessageId, allowed))
      .subscribe({
        next(thread) {
          if (generation !== request.current) return;
          if (!thread) {
            if (notificationSynced) {
              setOpenError('Сообщение удалено или недоступно.');
              onNotificationOpened?.();
            }
            return;
          }
          ++request.current;
          setOpenError('');
          setClosedNotificationChat(false);
          setNotificationChatContext(null);
          setNotificationEntityContext(null);
          setOpened({ row: { thread, contact: null, latest: null, unread: 0, hasAttachments: false },
            kind: 'notification', parent, messageId: notificationMessageId });
          onNotificationOpened?.();
        },
        error() {
          if (generation !== request.current) return;
          setOpenError('Не удалось открыть обсуждение.');
          onNotificationOpened?.();
        },
      });
    return () => subscription.unsubscribe();
  }, [notificationMessageId, db, actorId, notificationRealmsKey, canResolveNotification,
    notificationSynced, onNotificationOpened, parent]);
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
    const generation = ++request.current;
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
          onOpen={() => { ++request.current; setClientFilter({ parent }); }}
          onRemove={id => { ++request.current; setClientUserIds(current => current.filter(value => value !== id)); setLimit(50); }} />
      </div> : null}
      <div className="discussion-inbox__filters">
        <Button rounded tonal inline onClick={() => { ++request.current; setPicker({ side: 'from', parent }); }}><Text variant="footnote">{from ? `С ${discussionDateLabel(from)}` : 'С даты'}</Text></Button>
        <Button rounded tonal inline onClick={() => { ++request.current; setPicker({ side: 'to', parent }); }}><Text variant="footnote">{to ? `По ${discussionDateLabel(to)}` : 'По дату'}</Text></Button>
        {from || to || clientUserIds.length ? <Button rounded clear inline onClick={() => { ++request.current; setFrom(null); setTo(null); setClientUserIds([]); setLimit(50); }}><Text variant="footnote">Сбросить</Text></Button> : null}
      </div>
    </div>
    {from && to && from > to ? <Text variant="footnote" role="alert">Дата начала позже даты окончания</Text> : null}
    {cloud?.syncStatus === 'offline' ? <Text variant="caption">Нет соединения. Показаны обсуждения на устройстве.</Text>
      : cloud?.syncStatus === 'pending' ? <Text variant="caption">Синхронизируем обсуждения…</Text> : null}
    {cloud?.syncStatus === 'error' ? <Text variant="caption" role="status">Синхронизация прервана. Локальные обсуждения доступны.</Text> : null}
    {openError ? <Text role="alert">{openError}</Text> : null}
    {inbox.error ? <div className="stack"><Text role="alert">{inbox.error}</Text>
      <Button rounded tonal onClick={inbox.retry}><Text>Повторить</Text></Button></div> : null}
    {cloud?.status === 'error' && !rows.length ? <Text role="status">{cloud.error}</Text> : null}
    {inbox.loading && !rows.length ? <Text>Загружаем обсуждения…</Text>
      : cloud?.status === 'ready' && !inbox.error && !rows.length ? <Text>{from || to || clientUserIds.length ? 'За выбранный период обсуждений нет' : 'Обсуждений пока нет'}</Text> : null}
    <DiscussionInboxList rows={rows.slice(0, limit)} onOpen={row => { void openChat(row); }}
      onEntity={row => { ++request.current; setOpened({ row, kind: 'entity', parent }); }} />
    {rows.length > limit ? <Button rounded tonal onClick={() => setLimit(value => value + 50)}><Text>Показать ещё</Text></Button> : null}
    {role === 'coach' && !relationshipId ? <ScheduleClientFilter opened={clientFilter !== null}
      clients={clients} loading={cloud?.status === 'loading'} selected={clientUserIds}
      onClose={closeClientFilter} onApply={ids => {
        ++request.current; setClientUserIds(ids.filter(id => clients.some(contact => contact.userId === id)));
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
