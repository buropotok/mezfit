import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button, List as KonstaList, ListInput } from 'konsta/react';
import type { NavigationContext } from '../NavigationShell';
import { useNavigationSurfaceContext } from '../navigation/NavigationSurfaceContext';
import { useCloudConnections } from '../data/cloud/CloudConnectionsProvider';
import { DiscussionRepository } from '../data/cloud/discussions';
import { CloudContactAvatar } from '../contacts/CloudContactAvatar';
import { Avatar, Badge, DatePicker, Icon, IconButton, List, ListItem, Text, type LocalDate } from '../ui';
import { DiscussionSheet } from './DiscussionSheet';
import { DiscussionEntity } from './DiscussionEntity';
import { useDiscussions, type DiscussionInboxRow } from './DiscussionsProvider';
import { discussionDateLabel, discussionLocalDate, groupDiscussionFeed } from './feed-presentation';
import './discussions-page.css';

/** List actions are siblings through ListItem.trailingAction, never nested buttons. */
export function DiscussionInboxList({ rows, onOpen, onEntity }: {
  rows: readonly DiscussionInboxRow[]; onOpen: (row: DiscussionInboxRow) => void; onEntity: (row: DiscussionInboxRow) => void;
}) {
  return <>{groupDiscussionFeed(rows).map(group => <section key={group.date} aria-label={group.date || 'Без сообщений'}>
    <Text variant="footnote">{group.date ? discussionDateLabel(group.date) : 'Без сообщений'}</Text>
    <List divider="inset">{group.rows.map(row => <ListItem key={row.thread.id}
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
      trailingAction={<IconButton icon="chevron-right" label={`К сущности: ${row.thread.derivedTitleSnapshot}`}
        onClick={() => onEntity(row)} />} />)}</List>
  </section>)}</>;
}

export function DiscussionsPage({ role, relationshipId, onNavigationContextChange }: {
  role: 'coach' | 'client'; relationshipId?: string;
  onNavigationContextChange: (value: NavigationContext | null) => void;
}) {
  const cloud = useCloudConnections();
  const inbox = useDiscussions();
  const parent = useNavigationSurfaceContext();
  const [client, setClient] = useState('');
  const [from, setFrom] = useState<LocalDate | null>(null);
  const [to, setTo] = useState<LocalDate | null>(null);
  const [picker, setPicker] = useState<{ side: 'from' | 'to'; parent: NavigationContext | null } | null>(null);
  const [limit, setLimit] = useState(50);
  const [openError, setOpenError] = useState('');
  const request = useRef(0);
  const [opened, setOpened] = useState<{ row: DiscussionInboxRow; kind: 'chat' | 'entity'; parent: NavigationContext | null } | null>(null);
  const activeRow = opened ? inbox.rows.find(row => row.thread.anchorKey === opened.row.thread.anchorKey
    && row.thread.realmId === opened.row.thread.realmId) : undefined;
  const current = activeRow ? opened : null;
  const openRef = useRef(false);
  openRef.current = Boolean(current);
  useEffect(() => () => { openRef.current = false; ++request.current; }, []);
  const close = useCallback(() => { ++request.current; openRef.current = false; setOpened(null); }, []);
  const closePicker = useCallback(() => setPicker(null), []);
  const repository = useMemo(() => {
    if (!cloud || current?.kind !== 'chat') return null;
    try { return new DiscussionRepository(cloud.db, cloud.actorUserId, current.row.thread); }
    catch { return null; }
  }, [cloud?.db, cloud?.actorUserId, current]);
  const chatParent = useMemo<NavigationContext | null>(() => current
    ? { ...current.parent, level: 2, title: current.row.thread.derivedTitleSnapshot, onBack: close } : null, [current, close]);
  const chatNavigation = useCallback((value: NavigationContext | null) => {
    onNavigationContextChange(openRef.current ? value : null);
  }, [onNavigationContextChange]);
  useEffect(() => {
    if (!picker) return;
    onNavigationContextChange({ ...picker.parent, title: 'Период обсуждений', level: 2, onBack: closePicker });
    return () => onNavigationContextChange(picker.parent);
  }, [picker, closePicker, onNavigationContextChange]);
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
    if ((relationshipId || client) && row.thread.coachClientId !== (relationshipId || client)) return false;
    if (!from && !to) return true;
    if (!row.latest) return false;
    const date = discussionLocalDate(row.latest.createdAt);
    return (!from || date >= from) && (!to || date <= to);
  });
  if (current?.kind === 'entity') return <DiscussionEntity thread={current.row.thread} role={role}
    onBack={close} onNavigationContextChange={onNavigationContextChange} />;
  return <section className="discussion-inbox" aria-label="Обсуждения">
    {role === 'coach' && !relationshipId ? <KonstaList><ListInput type="select" label="Клиент" value={client}
      onChange={event => { ++request.current; setClient(event.target.value); setLimit(50); }}>
      <option value="">Все клиенты</option>
      {(cloud?.clients ?? []).map(contact => <option key={contact.relationshipId} value={contact.relationshipId}>{contact.displayName}</option>)}
    </ListInput></KonstaList> : null}
    <div className="discussion-inbox__filters">
      <Button rounded tonal inline onClick={() => { ++request.current; setPicker({ side: 'from', parent }); }}><Text variant="footnote">{from ? `С ${discussionDateLabel(from)}` : 'С даты'}</Text></Button>
      <Button rounded tonal inline onClick={() => { ++request.current; setPicker({ side: 'to', parent }); }}><Text variant="footnote">{to ? `По ${discussionDateLabel(to)}` : 'По дату'}</Text></Button>
      {from || to || client ? <Button rounded clear inline onClick={() => { ++request.current; setFrom(null); setTo(null); setClient(''); setLimit(50); }}><Text variant="footnote">Сбросить</Text></Button> : null}
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
      : cloud?.status === 'ready' && !inbox.error && !rows.length ? <Text>{from || to || client ? 'За выбранный период обсуждений нет' : 'Обсуждений пока нет'}</Text> : null}
    <DiscussionInboxList rows={rows.slice(0, limit)} onOpen={row => { void openChat(row); }}
      onEntity={row => { ++request.current; setOpened({ row, kind: 'entity', parent }); }} />
    {rows.length > limit ? <Button rounded tonal onClick={() => setLimit(value => value + 50)}><Text>Показать ещё</Text></Button> : null}
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
