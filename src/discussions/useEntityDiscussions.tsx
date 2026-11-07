import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, List, ListItem } from 'konsta/react';
import type { NavigationContext } from '../NavigationShell';
import { useNavigationSurfaceContext } from '../navigation/NavigationSurfaceContext';
import { useCloudConnections } from '../data/cloud/CloudConnectionsProvider';
import { CLOUD_DISCUSSIONS_ENABLED } from '../data/cloud/discussion-activation';
import { DiscussionRepository, prepareDiscussionThread, type CreateDiscussionThread } from '../data/cloud/discussions';
import type { DiscussionThread } from '../data/cloud/discussion-contracts';
import { discussionAnchorKey } from '../../shared/discussion-anchor';
import { MezfitBottomSheet } from '../ui/konsta-mezfit/BottomSheet';
import { IconButton, Text } from '../ui/primitives';
import { UnreadCount } from '../ui/UnreadCount';
import type { LiquidPopoverItem } from '../ui/LiquidPopover';
import { DiscussionSheet } from './DiscussionSheet';
import type { EntityDiscussionTarget } from './entity-discussion-target';
import './entity-discussions.css';

type Snapshot = { threads: DiscussionThread[]; unread: number; unreadByThread: Record<string, number> };
const EMPTY: Snapshot = { threads: [], unread: 0, unreadByThread: {} };

/** Owns only the overlay. The source screen, filters and shell Back stack stay mounted. */
export function useEntityDiscussions(target: EntityDiscussionTarget | null,
  onNavigationContextChange?: (value: NavigationContext | null) => void, enabled = true) {
  const cloud = useCloudConnections();
  const accountKey = useMemo(() => crypto.randomUUID(), [cloud?.db, cloud?.actorUserId]);
  const currentAccount = useRef(accountKey);
  currentAccount.current = accountKey;
  const sourceNavigation = useNavigationSurfaceContext();
  const [parentNavigation, setParentNavigation] = useState<NavigationContext | null>(null);
  // Capture source context only when opening: historical titles never retarget to a new entity.
  const [openedTarget, setOpenedTarget] = useState<EntityDiscussionTarget | null>(null);
  const [openedAccount, setOpenedAccount] = useState<string | null>(null);
  const belongsToAccount = openedAccount === accountKey;
  const activeTarget = (belongsToAccount ? openedTarget : null) ?? target;
  const key = activeTarget ? discussionAnchorKey(activeTarget.scope, activeTarget.anchor) : '';
  const repository = useMemo(() => enabled && CLOUD_DISCUSSIONS_ENABLED && cloud && activeTarget
    ? new DiscussionRepository(cloud.db, cloud.actorUserId, activeTarget.scope) : null,
  [enabled, cloud?.db, cloud?.actorUserId, activeTarget?.scope.realmId, activeTarget?.scope.coachClientId]);
  const [observed, setObserved] = useState<{ repository: DiscussionRepository; key: string; value: Snapshot } | null>(null);
  const snapshot = observed?.repository === repository && observed?.key === key ? observed.value : EMPTY;
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const pendingCreate = useRef<CreateDiscussionThread | null>(null);
  const creating = useRef(false);
  const generation = useRef(0);
  const pendingOpen = useRef<{ target: EntityDiscussionTarget; navigation: NavigationContext | null; account: string } | null>(null);
  useEffect(() => {
    let active = true;
    setObserved(null); setError(''); setLoading(true);
    if (!repository || !activeTarget) return;
    const subscription = repository.observeAnchor(activeTarget.anchor, value => {
      if (active) { setObserved({ repository, key, value }); setLoading(false); setError(''); }
    }, () => {
      if (active) { setObserved(null); setLoading(false); setError('Не удалось открыть обсуждения'); }
    });
    return () => { active = false; subscription.unsubscribe(); };
  }, [repository, key, retry]);
  useEffect(() => {
    ++generation.current;
    creating.current = false; pendingCreate.current = null; setBusy(false);
    return () => { ++generation.current; };
  }, [repository, key, openedTarget !== null]);
  const close = useCallback(() => { setOpenedTarget(null); setThreadId(null); }, []);
  const backToList = useCallback(() => setThreadId(null), []);
  const listNavigation = useMemo<NavigationContext>(() => ({ ...parentNavigation,
    level: 2, title: parentNavigation?.title ?? 'Обсуждения', onBack: close }), [close, parentNavigation]);
  const overlayOpen = useRef(false);
  overlayOpen.current = belongsToAccount && openedTarget !== null && enabled;
  const navigationAlive = useRef(true);
  useEffect(() => {
    navigationAlive.current = true;
    return () => { navigationAlive.current = false; };
  }, []);
  const threadNavigationChange = useCallback((value: NavigationContext | null) => {
    if (navigationAlive.current) onNavigationContextChange?.(overlayOpen.current ? value : null);
  }, [onNavigationContextChange]);
  useEffect(() => {
    if (!openedTarget || !belongsToAccount || !enabled || threadId) return;
    onNavigationContextChange?.(listNavigation);
    return () => onNavigationContextChange?.(null);
  }, [openedTarget, belongsToAccount, enabled, threadId, listNavigation, onNavigationContextChange]);
  // The account and source owner can change while an async create is still finishing.
  useEffect(() => {
    close(); pendingOpen.current = null;
  }, [accountKey, enabled, close]);
  const sourceKey = target ? discussionAnchorKey(target.scope, target.anchor) : '';
  useEffect(() => {
    if (sourceKey && openedTarget && sourceKey !== discussionAnchorKey(openedTarget.scope, openedTarget.anchor)) close();
    pendingOpen.current = null;
  }, [sourceKey, close]);

  const create = async () => {
    if (!repository || !openedTarget || creating.current || error || loading || !target) return;
    creating.current = true; setBusy(true);
    const version = generation.current;
    const date = new Date();
    const day = [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
    try {
      pendingCreate.current ??= prepareDiscussionThread(openedTarget.anchor, openedTarget.name.trim().slice(0, 120), day);
      const thread = await repository.createThread(pendingCreate.current);
      if (version === generation.current) { pendingCreate.current = null; setThreadId(thread.id); }
    } catch { if (version === generation.current) setError('Не удалось создать обсуждение'); }
    finally { if (version === generation.current) { creating.current = false; setBusy(false); } }
  };
  const menuItem: LiquidPopoverItem = { id: 'discussions', label: 'Обсуждения', icon: 'message-circle',
    unreadCount: snapshot.unread, disabled: !repository || !onNavigationContextChange || !target,
    onSelect: () => { if (repository && target) pendingOpen.current = { target, navigation: sourceNavigation, account: accountKey }; } };
  const onMenuPresentationChange = (presented: boolean) => {
    if (presented || !pendingOpen.current) return;
    if (pendingOpen.current.account !== currentAccount.current) { pendingOpen.current = null; return; }
    setOpenedAccount(pendingOpen.current.account);
    setOpenedTarget(pendingOpen.current.target); setParentNavigation(pendingOpen.current.navigation);
    pendingOpen.current = null; setThreadId(null);
  };
  const resolveAuthor = (id: string) => ({ name: id === cloud?.actorUserId ? 'Вы'
    : [...(cloud?.clients ?? []), ...(cloud?.coaches ?? [])].find(person => person.userId === id
      && person.relationshipId === activeTarget?.scope.realmId)?.displayName ?? 'Участник обсуждения' });
  const content = openedTarget && belongsToAccount && enabled && repository ? <>
    {!threadId && <MezfitBottomSheet opened label="Обсуждения" lazyMount>
      <div className="entity-discussions">
        <header className="entity-discussions__header"><Text variant="headline">Обсуждения</Text>
          <IconButton icon="x" label="Закрыть обсуждения" onClick={close} /></header>
        <Button rounded tonal onClick={close}><Text>{openedTarget.name}</Text></Button>
        {!target && <Text variant="footnote">Исходный объект недоступен. Сохранена история обсуждений.</Text>}
        {loading && <Text variant="footnote" role="status">Загружаем обсуждения…</Text>}
        {error && <div role="alert"><Text>{error}</Text>
          <Button rounded onClick={() => { setError(''); setRetry(value => value + 1); }}>Повторить</Button></div>}
        {!loading && !error && <>
          <List strong inset>{snapshot.threads.map(thread => <ListItem key={thread.id} link
            title={<Text>{thread.derivedTitleSnapshot}</Text>}
            after={<UnreadCount count={snapshot.unreadByThread[thread.id] ?? 0} />}
            onClick={() => setThreadId(thread.id)} />)}</List>
          {!snapshot.threads.length && <Text variant="body">Обсуждений пока нет</Text>}
          <Button rounded disabled={busy || !target} onClick={() => void create()}><Text>{busy ? 'Создаём…' : 'Создать обсуждение'}</Text></Button>
        </>}
      </div>
    </MezfitBottomSheet>}
    {threadId && onNavigationContextChange && <DiscussionSheet opened repository={repository} threadId={threadId}
      anchor={openedTarget.anchor} onClose={close} onBack={backToList} resolveAuthor={resolveAuthor}
      onNavigationContextChange={threadNavigationChange} parentNavigation={listNavigation}
      contextLabel={openedTarget.name} onOpenContext={close} />}
  </> : null;
  return { menuItem, unread: snapshot.unread, content, onMenuPresentationChange };
}
