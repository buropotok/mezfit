import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from 'konsta/react';
import { createPortal } from 'react-dom';
import type { NavigationContext } from '../NavigationShell';
import { useNavigationSurfaceContext } from '../navigation/NavigationSurfaceContext';
import { useCloudConnections } from '../data/cloud/CloudConnectionsProvider';
import { DiscussionRepository } from '../data/cloud/discussions';
import { discussionAnchorKey } from '../../shared/discussion-anchor';
import type { LiquidPopoverItem } from '../ui/LiquidPopover';
import { DiscussionSheet } from './DiscussionSheet';
import { MezfitBottomSheet } from '../ui/konsta-mezfit/BottomSheet';
import { IconButton, Text } from '../ui/primitives';
import type { EntityDiscussionTarget } from './entity-discussion-target';
import './entity-discussions.css';

/** The source remains mounted; the existing shell owns Back throughout opening and reading. */
export function useEntityDiscussions(target: EntityDiscussionTarget | null,
  onNavigationContextChange?: (value: NavigationContext | null) => void, enabled = true) {
  const cloud = useCloudConnections();
  const sourceNavigation = useNavigationSurfaceContext();
  const account = useMemo(() => ({}), [cloud?.db, cloud?.actorUserId]);
  const [opened, setOpened] = useState<{ target: EntityDiscussionTarget; parent: NavigationContext | null; account: object } | null>(null);
  const current = opened?.account === account && enabled ? opened : null;
  const activeTarget = current?.target ?? target;
  const key = activeTarget ? discussionAnchorKey(activeTarget.scope, activeTarget.anchor) : '';
  const [retry, setRetry] = useState(0);
  // Constructor errors are a feature failure, not a reason to lose the program screen.
  // Keep identity/schema checks in the repository and present a retryable local error.
  const connection = useMemo(() => {
    if (!enabled || !onNavigationContextChange || !cloud || !activeTarget) return { repository: null, error: '' };
    try { return { repository: new DiscussionRepository(cloud.db, cloud.actorUserId, activeTarget.scope), error: '' }; }
    catch { return { repository: null, error: 'Не удалось подключить обсуждение' }; }
  }, [enabled, onNavigationContextChange, cloud?.db, cloud?.actorUserId,
    activeTarget?.scope.realmId, activeTarget?.scope.coachClientId, retry]);
  const repository = connection.repository;
  const [observed, setObserved] = useState<{ repository: DiscussionRepository; key: string; unread: number } | null>(null);
  const unread = observed?.repository === repository && observed?.key === key ? observed.unread : 0;
  const [thread, setThread] = useState<{ opened: typeof opened; id: string } | null>(null);
  const [error, setError] = useState('');
  const pending = useRef<typeof opened>(null);
  const close = useCallback(() => { pending.current = null; setOpened(null); setThread(null); }, []);
  const sourceKey = target ? discussionAnchorKey(target.scope, target.anchor) : '';
  useEffect(() => {
    if (sourceKey && current && sourceKey !== discussionAnchorKey(current.target.scope, current.target.anchor)) close();
    pending.current = null;
  }, [sourceKey, account, enabled, close]);
  useEffect(() => {
    if (!repository || !activeTarget) return;
    let active = true;
    const sub = repository.observeAnchor(activeTarget.anchor, value => {
      if (active) setObserved({ repository, key, unread: value.unread });
    }, () => { if (active) setObserved(null); });
    return () => { active = false; sub.unsubscribe(); };
  }, [repository, key, retry]);
  useEffect(() => {
    setError('');
    if (!current || !repository) return;
    let active = true;
    void repository.ensureEntityThread(current.target.anchor, current.target.name).then(value => {
      if (active) setThread({ opened: current, id: value.id });
    }, () => { if (active) setError('Не удалось открыть обсуждение'); });
    return () => { active = false; };
  }, [current, repository, retry]);
  const navigation = useMemo<NavigationContext>(() => ({ ...current?.parent,
    level: 2, title: current?.target.name ?? 'Обсуждение', onBack: close }), [current, close]);
  const openRef = useRef(false);
  openRef.current = Boolean(current);
  useEffect(() => () => { openRef.current = false; pending.current = null; }, []);
  const threadNavigationChange = useCallback((value: NavigationContext | null) => {
    onNavigationContextChange?.(openRef.current ? value : null);
  }, [onNavigationContextChange]);
  useEffect(() => {
    if (!current) return;
    onNavigationContextChange?.(navigation);
    return () => onNavigationContextChange?.(null);
  }, [current, navigation, onNavigationContextChange]);
  const canOpen = Boolean(enabled && cloud && target && onNavigationContextChange);
  const open = () => {
    if (canOpen && target) setOpened({ target, parent: sourceNavigation, account });
  };
  const menuItem: LiquidPopoverItem = { id: 'discussions', label: 'Обсуждения', icon: 'message-circle',
    unreadCount: unread, disabled: !canOpen,
    onSelect: () => { if (canOpen && target) pending.current = { target, parent: sourceNavigation, account }; } };
  const onMenuPresentationChange = (presented: boolean) => {
    if (presented || !pending.current) return;
    if (pending.current.account === account) setOpened(pending.current);
    pending.current = null;
  };
  const resolveAuthor = (id: string) => ({ name: id === cloud?.actorUserId ? 'Вы'
    : [...(cloud?.clients ?? []), ...(cloud?.coaches ?? [])].find(person => person.userId === id
      && person.relationshipId === activeTarget?.scope.realmId)?.displayName ?? 'Участник обсуждения' });
  const threadId = thread?.opened === current ? thread?.id : null;
  const content = current && onNavigationContextChange ? repository
    ? <DiscussionSheet opened repository={repository} threadId={threadId ?? ''} anchor={current.target.anchor}
      opening={threadId ? undefined : { error, retry: () => setRetry(value => value + 1) }}
      onClose={close} onBack={close} resolveAuthor={resolveAuthor} contextLabel={current.target.name}
      onNavigationContextChange={threadNavigationChange} parentNavigation={navigation} />
    : <MezfitBottomSheet opened label="Обсуждение" lazyMount><div className="entity-discussions">
      <header className="entity-discussions__header"><Text variant="headline">{current.target.name}</Text>
        <IconButton icon="x" label="Закрыть обсуждение" onClick={close} /></header>
      <Text role="alert">{connection.error || 'Обсуждение недоступно'}</Text>
      <Button rounded onClick={() => setRetry(value => value + 1)}>Повторить</Button>
    </div></MezfitBottomSheet> : null;
  // GlassSurface owns a clipping/containing block. Mount the feature overlay
  // outside every program row while retaining React context and shell Back ownership.
  return { menuItem, unread, content: content && typeof document !== 'undefined'
    ? createPortal(<div className="navigation-overlay-root k-ios dark safe-areas">{content}</div>, document.body) : content, onMenuPresentationChange, open, canOpen };
}
