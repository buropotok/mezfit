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
import { DiscussionVideoRecorder } from './DiscussionVideoRecorder';
import { MezfitBottomSheet } from '../ui/konsta-mezfit/BottomSheet';
import { MezfitPopover } from '../ui/konsta-mezfit/Popover';
import { IconButton, Text } from '../ui/primitives';
import type { EntityDiscussionTarget, OpenEntityDiscussion } from './entity-discussion-target';
import './entity-discussions.css';

type DraftDiscussionGuard = { kind: 'program' } | { kind: 'workout'; onPublish: () => void };

interface OpenedEntity {
  target: EntityDiscussionTarget;
  parent: NavigationContext | null;
  account: object;
  recording?: boolean;
  takeRecordedVideo?: () => File | undefined;
}

/** The source remains mounted; the existing shell owns Back throughout opening and reading. */
export function useEntityDiscussions(target: EntityDiscussionTarget | null,
  onNavigationContextChange?: (value: NavigationContext | null) => void, enabled = true,
  options?: { onOpenTarget?: OpenEntityDiscussion;
    isTargetAvailable?: (target: EntityDiscussionTarget) => boolean;
    draftGuard?: DraftDiscussionGuard }) {
  const cloud = useCloudConnections();
  const sourceNavigation = useNavigationSurfaceContext();
  const account = useMemo(() => ({}), [cloud?.db, cloud?.actorUserId]);
  const [opened, setOpened] = useState<OpenedEntity | null>(null);
  const [draftPromptOpen, setDraftPromptOpen] = useState(false);
  const closeDraftPrompt = useCallback(() => setDraftPromptOpen(false), []);
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
    closeDraftPrompt();
  }, [sourceKey, account, enabled, close, closeDraftPrompt]);
  useEffect(() => { if (!options?.draftGuard) closeDraftPrompt(); }, [options?.draftGuard?.kind, closeDraftPrompt]);
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
    if (!current || current.recording || !repository) return;
    let active = true;
    void repository.ensureEntityThread(current.target.anchor, current.target.name).then(value => {
      if (active) setThread({ opened: current, id: value.id });
    }, () => { if (active) setError('Не удалось открыть обсуждение'); });
    return () => { active = false; };
  }, [current, repository, retry]);
  const navigation = useMemo<NavigationContext>(() => ({ ...current?.parent,
    level: 2, title: current?.recording ? 'Запись видео' : current?.target.name ?? 'Обсуждение', onBack: close }), [current, close]);
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
  useEffect(() => {
    if (!draftPromptOpen || !options?.draftGuard || !onNavigationContextChange) return;
    onNavigationContextChange({ ...sourceNavigation, level: 2, title: 'Обсуждение', onBack: closeDraftPrompt });
    return () => onNavigationContextChange(null);
  }, [draftPromptOpen, options?.draftGuard?.kind, onNavigationContextChange, sourceNavigation, closeDraftPrompt]);
  const canOpen = Boolean(enabled && cloud && target && onNavigationContextChange);
  const canRecordVideo = canOpen && Boolean(repository?.supportsMedia);
  const openTarget: OpenEntityDiscussion = (nextTarget, action) => {
    if (action === 'record-video' && options?.isTargetAvailable?.(nextTarget) === false) return;
    if (!enabled || !cloud || !onNavigationContextChange) return;
    if (options?.draftGuard) { setDraftPromptOpen(true); return; }
    setOpened({ target: nextTarget, parent: sourceNavigation, account, recording: action === 'record-video' });
  };
  const open = () => { if (canOpen && target) openTarget(target); };
  const menuItem: LiquidPopoverItem = { id: 'discussions', label: 'Обсуждения', icon: 'message-circle',
    unreadCount: unread, disabled: !canOpen,
    onSelect: () => { if (canOpen && target) pending.current = { target, parent: sourceNavigation, account }; } };
  const onMenuPresentationChange = (presented: boolean) => {
    if (presented || !pending.current) return;
    if (pending.current.account === account) {
      if (options?.draftGuard) setDraftPromptOpen(true);
      else if (options?.onOpenTarget) options.onOpenTarget(pending.current.target);
      else setOpened(pending.current);
    }
    pending.current = null;
  };
  const resolveAuthor = (id: string) => ({ name: id === cloud?.actorUserId ? 'Вы'
    : [...(cloud?.clients ?? []), ...(cloud?.coaches ?? [])].find(person => person.userId === id
      && person.relationshipId === activeTarget?.scope.realmId)?.displayName ?? 'Участник обсуждения' });
  const threadId = thread?.opened === current ? thread?.id : null;
  const confirmVideo = (recording: OpenedEntity, file: File) => {
    let pendingVideo: File | undefined = file;
    const takeRecordedVideo = () => {
      const video = pendingVideo;
      pendingVideo = undefined;
      return video;
    };
    setOpened(previous => previous === recording ? { ...previous, recording: false, takeRecordedVideo } : previous);
  };
  const content = current && onNavigationContextChange ? current.recording
    ? <DiscussionVideoRecorder onCancel={close} onUse={file => {
      if (options?.isTargetAvailable?.(current.target) === false) close();
      else confirmVideo(current, file);
    }} /> : repository
    ? <DiscussionSheet opened repository={repository} threadId={threadId ?? ''} anchor={current.target.anchor}
      opening={threadId ? undefined : { error, retry: () => setRetry(value => value + 1) }}
      onClose={close} onBack={close} resolveAuthor={resolveAuthor}
      contextLabel={current.target.name} contextUnavailable={options?.isTargetAvailable?.(current.target) === false}
      takeRecordedVideo={current.takeRecordedVideo}
      onNavigationContextChange={threadNavigationChange} parentNavigation={navigation} />
    : <MezfitBottomSheet opened label="Обсуждение" lazyMount><div className="entity-discussions">
      <header className="entity-discussions__header"><Text variant="headline">{current.target.name}</Text>
        <IconButton icon="x" label="Закрыть обсуждение" onClick={close} /></header>
      <Text role="alert">{connection.error || 'Обсуждение недоступно'}</Text>
      <Button rounded onClick={() => setRetry(value => value + 1)}>Повторить</Button>
    </div></MezfitBottomSheet> : null;
  const draftPrompt = draftPromptOpen && options?.draftGuard ? <MezfitPopover
    opened role="dialog" aria-label="Обсуждение черновика"
    viewportTop={typeof window === 'undefined' ? 120 : Math.max(80, Math.round(window.innerHeight * 0.3))}
    onBackdropClick={closeDraftPrompt}>
    <div className="flex flex-col gap-4 p-4">
      <Text variant="body">Обсуждение в рамках черновика невозможно.</Text>
      {options.draftGuard.kind === 'workout' ? <>
        <Text variant="body">Опубликовать тренировку?</Text>
        <div className="flex justify-end gap-2">
          <Button rounded tonal onClick={closeDraftPrompt}>Нет</Button>
          <Button rounded strong onClick={() => { closeDraftPrompt(); options.draftGuard?.kind === 'workout' && options.draftGuard.onPublish(); }}>Да</Button>
        </div>
      </> : <Button rounded onClick={closeDraftPrompt}>Продолжить</Button>}
    </div>
  </MezfitPopover> : null;
  const overlayContent = <>{content}{draftPrompt}</>;
  // GlassSurface owns a clipping/containing block. Mount the feature overlay
  // outside every program row while retaining React context and shell Back ownership.
  return { menuItem, unread, content: (content || draftPrompt) && typeof document !== 'undefined'
    ? createPortal(<div className="navigation-overlay-root k-ios dark safe-areas">{overlayContent}</div>, document.body) : null, onMenuPresentationChange, open, openTarget, canOpen, canRecordVideo };
}
