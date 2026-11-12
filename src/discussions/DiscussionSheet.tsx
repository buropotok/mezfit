import { Fragment, useEffect, useEffectEvent, useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ChangeEvent, type ReactNode } from 'react';
import { Button, Messages, MessagesTitle, Toast } from 'konsta/react';
import { sameDiscussionVideoPosition, type DiscussionVideoPosition, type MessageAttachment } from '../data/cloud/discussion-contracts';
import type { DiscussionMessageInput } from '../data/cloud/discussions';
import { discussionCursorKey, type DiscussionMessageView, type DiscussionQuote, type DiscussionReceiptSnapshot } from '../data/cloud/discussion-views';
import type { DiscussionSyncState } from '../data/cloud/discussion-sync';
import type { NavigationContext } from '../NavigationShell';
import { Avatar, IconButton, Text } from '../ui/primitives';
import { Icon } from '../ui/Icon';
import { Badge, BadgeChoice } from '../ui/Badge';
import { GlassSurface } from '../ui/GlassSurface';
import { MezfitMessagebar } from '../ui/konsta-mezfit/Messagebar';
import { DiscussionActionIcon } from './DiscussionActionIcon';
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
import { DiscussionMedia, type DiscussionMediaSource } from './DiscussionMedia';
import { DiscussionOutgoingMedia } from './DiscussionOutgoingMedia';
import { useDiscussionMedia } from './useDiscussionMedia';
import { useDiscussionVoice } from './useDiscussionVoice';
import { useDiscussionVideoNote } from './useDiscussionVideoNote';
import { DiscussionVideoNote, DiscussionVideoNoteCapture } from './DiscussionVideoNote';
import { DiscussionVoice } from './DiscussionVoice';
import { DiscussionRecordingStatus } from './DiscussionRecordingStatus';
import { DiscussionVoiceTrash } from './DiscussionVoiceTrash';
import { DiscussionMediaStage } from './DiscussionMediaStage';
import { DiscussionVideoRecorder } from './DiscussionVideoRecorder';
import { DiscussionVideoSaveDialog, type DiscussionVideoSaveTarget } from './DiscussionVideoSaveDialog';
import { startPressScale } from '../ui/PressScale';
import { useRecordingButtonAnimation } from './useRecordingButtonAnimation';
import { RECORDING_LOCK_DISTANCE } from './useRecordingGesture';
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
  /** The set recorder supplies one confirmed take for this exact thread. */
  takeRecordedVideo?: () => File | undefined;
  glassSettings?: GlassSettings;
  /** Compact direct conversation by default; retain native author presentation for groups. */
  showAvatars?: boolean;
  renderAttachment?: (message: DiscussionMessageView) => ReactNode;
}

function galleryMediaSource(attachment: MessageAttachment, accountId: string): DiscussionMediaSource | null {
  const { storageKey, mediaType, mimeType, sizeBytes, durationSeconds } = attachment;
  const src = storageKey && directMediaUrl(storageKey);
  if (!storageKey || !src || mediaType === 'voice' || mediaType === 'video-note') return null;
  return { src, type: mediaType, durationSeconds, cache: { accountId, storageKey, mimeType, sizeBytes } };
}

const videoCommentHintKey = 'mezfit.discussion.videoCommentUsed';

function hasUsedVideoComment() {
  try { return localStorage.getItem(videoCommentHintKey) === 'true'; }
  catch { return false; }
}

function formatVideoPosition(seconds: number) {
  const whole = Math.floor(seconds);
  return `${String(Math.floor(whole / 60)).padStart(2, '0')}:${String(whole % 60).padStart(2, '0')}`;
}

function Quote({ quote, resolveAuthor, onJump }: {
  quote: DiscussionQuote; resolveAuthor: DiscussionSheetProps['resolveAuthor']; onJump?: () => void;
}) {
  const author = <Text variant="caption">{quote.authorUserId ? resolveAuthor(quote.authorUserId).name : 'Исходное сообщение'}</Text>;
  return <button type="button" className="discussion-quote" disabled={quote.unavailable || Boolean(quote.deleted && quote.videoPosition)} onClick={event => {
    event.stopPropagation(); onJump?.();
  }} aria-label={quote.videoPosition ? `Открыть видео на ${formatVideoPosition(quote.videoPosition.seconds)}` : 'Перейти к исходному сообщению'}>
    {quote.videoPosition ? <span className="discussion-quote__heading">
      {author}
      <Badge color="yellow" textVariant="caption">{formatVideoPosition(quote.videoPosition.seconds)}</Badge>
    </span> : author}
    <Text variant="footnote" className="discussion-quote__text">{quote.deleted ? 'Сообщение удалено'
      : quote.unavailable ? 'Сообщение недоступно' : quote.text || (quote.videoPosition ? 'Видео' : '')}</Text>
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
  onNavigationContextChange, parentNavigation, contextLabel, contextUnavailable, takeRecordedVideo, glassSettings, showAvatars = false, renderAttachment }: DiscussionSheetProps) {
  const targetKey = JSON.stringify([threadId, anchor]);
  const session = useMemo(() => new DiscussionSession(repository, { threadId, anchor }), [repository, targetKey]);
  const state = useSyncExternalStore(session.subscribe, session.snapshot, session.snapshot);
  const draft = useDiscussionDraft(repository, threadId);
  const media = useDiscussionMedia(repository, draft);
  const sendRecordedVideo = useEffectEvent((file: File) => {
    void media.choose(file, { sendToThread: threadId });
  });
  useEffect(() => {
    if (!repository.supportsMedia || !draft.ready || !state.title || state.error || contextUnavailable) return;
    const file = takeRecordedVideo?.();
    if (file) sendRecordedVideo(file);
  }, [takeRecordedVideo, repository.supportsMedia, draft.ready, state.title, state.error, contextUnavailable]);
  const voice = useDiscussionVoice(media.chooseVoice, () => discardVoice());
  const videoNote = useDiscussionVideoNote(media.sendVideoNote, () => discardVoice());
  const [videoPlaybackHost, setVideoPlaybackHost] = useState<HTMLDivElement | null>(null);
  const recordingVoice = voice.status === 'recording';
  const recordingCircle = videoNote.status === 'recording';
  const circleInProgress = recordingCircle || videoNote.status === 'requesting' || videoNote.status === 'processing';
  const voiceInProgress = recordingVoice || voice.status === 'requesting' || voice.status === 'processing';
  const outgoing = media.outgoing && media.selection?.metadata.id === media.outgoing.attachmentId
    ? media.outgoing : undefined;
  const outgoingStatus = media.phase === 'checking' || media.phase === 'idle' ? undefined : media.phase;
  const outgoingVideo = outgoing && media.selection
    && (media.selection.metadata.mediaType === 'video' || media.selection.metadata.mediaType === 'video-note')
    ? media.selection : undefined;
  const published = media.published;
  const publishedObserved = Boolean(published && state.messages.some(message => message.id === published.id));
  const renderedMessages = published && !publishedObserved ? [...state.messages, published] : state.messages;
  const clearPublished = media.setPublished;
  useEffect(() => { if (publishedObserved) clearPublished(undefined); }, [publishedObserved, clearPublished]);
  const activeAttachment = outgoing ? undefined : media.selection?.metadata ?? draft.media;
  const voiceDraft = activeAttachment?.mediaType === 'voice' ? activeAttachment : undefined;
  const circleDraft = activeAttachment?.mediaType === 'video-note' ? activeAttachment : undefined;
  const addSurface = useRef<HTMLElement>(null);
  const actionSurface = useRef<HTMLElement>(null);
  const recordingGesture = voice.phase !== 'idle' ? voice : videoNote;
  const lockedRecording = recordingGesture.phase === 'locked';
  const holdingRecording = recordingGesture.phase === 'holding' || lockedRecording;
  useRecordingButtonAnimation(actionSurface, recordingGesture.phase);
  const removingVoice = useRef(false);
  const discardAnimationDone = useRef(false);
  const discardRemovalDone = useRef(false);
  const [discardingVoice, setDiscardingVoice] = useState(false);
  const voiceComposer = voiceInProgress || Boolean(voiceDraft) || discardingVoice;
  const gallery = useRef<HTMLInputElement>(null);
  const photoPicker = useRef<HTMLInputElement>(null);
  const [attachmentsOpen, setAttachmentsOpen] = useState(false);
  const [attachmentsPresented, setAttachmentsPresented] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const mediaBusy = media.phase !== 'idle' && media.phase !== 'failed';
  const mediaPresent = Boolean(activeAttachment);
  const previewing = Boolean(media.preview && media.selection && !voiceDraft && !circleDraft
    && !outgoing);
  const [viewing, setViewing] = useState<{
    messageId: string;
    attachmentId: string;
    startAt?: number;
    source?: DiscussionMediaSource;
  } | null>(null);
  const viewerRequest = useRef(0);
  const openViewer = (messageId: string, attachmentId: string) => {
    ++viewerRequest.current;
    setViewing({ messageId, attachmentId });
  };
  const [videoCommentUsed, setVideoCommentUsed] = useState(hasUsedVideoComment);
  const [fullscreenVideo, setFullscreenVideo] = useState<string | null>(null);
  const viewedMessage = viewing && renderedMessages.find(row => row.id === viewing.messageId);
  const viewedAttachment = viewing && viewedMessage && !viewedMessage.deleted
    ? viewedMessage.attachments?.find(attachment => attachment.id === viewing.attachmentId) : undefined;
  const localVideoUrl = viewing && outgoing?.id === viewing.messageId
    && outgoingVideo?.metadata.id === viewing.attachmentId && outgoingVideo.metadata.mediaType === 'video' && media.preview
    ? media.preview : undefined;
  const viewer: DiscussionMediaSource | null = localVideoUrl
    ? { src: localVideoUrl, type: 'video' }
    : viewedAttachment ? galleryMediaSource(viewedAttachment, repository.actorUserId)
      : viewedMessage?.deleted ? null : viewing?.source ?? null;
  const previewVideoUrl = previewing && media.selection?.metadata.mediaType === 'video' ? media.preview : undefined;
  const videoUrl = viewer ? (viewer.type === 'video' ? viewer.src : undefined) : previewVideoUrl;
  const videoSpeedKey = viewer?.type === 'video' && viewing
    ? `viewer:${viewing.messageId}:${viewing.attachmentId}:${viewing.startAt ?? ''}`
    : previewVideoUrl && media.selection ? `preview:${media.selection.metadata.id}` : '';
  const [videoSpeed, setVideoSpeed] = useState(1);
  const [speedOpen, setSpeedOpen] = useState(false);
  const speedTrigger = useRef<HTMLButtonElement>(null);
  useEffect(() => { setVideoSpeed(1); setSpeedOpen(false); }, [videoSpeedKey]);
  const speedMenu = videoUrl && <LiquidPopover isOpen={speedOpen} onOpenChange={setSpeedOpen}
    triggerRef={speedTrigger} label="Скорость воспроизведения" layout="menu"
    items={[0.25, 0.5, 0.75, 1, 1.5, 2].map(rate => ({
      id: String(rate), label: `${rate}×`, icon: videoSpeed === rate ? 'check' as const : undefined,
      active: videoSpeed === rate, onSelect: () => setVideoSpeed(rate),
    }))}
    trigger={<IconButton ref={speedTrigger} icon="gauge" label="Скорость воспроизведения" />} />;
  const videoFullscreen = Boolean(videoUrl && videoUrl === fullscreenVideo);
  const fullscreenButton = videoUrl && <IconButton icon={videoFullscreen ? 'arrows-minimize' : 'arrows-maximize'}
    label={videoFullscreen ? 'Выйти из полноэкранного режима' : 'Во весь экран'}
    onClick={() => { setSpeedOpen(false); setFullscreenVideo(videoFullscreen ? null : videoUrl); }} />;
  const mediaSurfaceOpen = previewing || Boolean(viewer) || cameraOpen;
  const [editText, setEditText] = useState('');
  const [editId, setEditId] = useState<string | null>(null);
  const replyId = editId ? null : draft.replyId;
  const text = editId ? editText : draft.text;
  const setText = (value: string) => { if (editId) setEditText(value); else draft.update(value, replyId, draft.videoPosition); };
  const [deleting, setDeleting] = useState<{ id: string; kind: 'published' | 'outgoing-video' } | null>(null);
  const deletingOutgoingVideo = deleting?.kind === 'outgoing-video';
  const [savingVideo, setSavingVideo] = useState<DiscussionVideoSaveTarget | null>(null);
  const [videoSaveNotice, setVideoSaveNotice] = useState('');
  useEffect(() => {
    if (!videoSaveNotice) return;
    const timer = window.setTimeout(() => setVideoSaveNotice(''), 8_000);
    return () => window.clearTimeout(timer);
  }, [videoSaveNotice]);
  const [menu, setMenu] = useState<{ id: string; open: boolean } | null>(null);
  const menuRef = useRef(menu);
  menuRef.current = menu;
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [mediaMode, setMediaMode] = useState<'microphone' | 'camera'>('microphone');
  const canCompose = !cameraOpen && !busy && !mediaBusy && !outgoing && draft.ready && Boolean(state.title) && !state.error;
  const actionMode = lockedRecording || editId !== null || mediaPresent || Boolean(text.trim()) ? 'send' : mediaMode;
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
  const closePreview = () => {
    if (media.phase === 'uploading') media.cancel();
    else if (!mediaBusy) void media.remove();
  };
  const finishVoiceDiscard = () => {
    if (!alive.current || !removingVoice.current
      || !discardAnimationDone.current || !discardRemovalDone.current) return;
    removingVoice.current = false;
    setDiscardingVoice(false);
  };
  const discardVoice = () => {
    if (removingVoice.current || mediaBusy) return;
    removingVoice.current = true;
    discardAnimationDone.current = false;
    discardRemovalDone.current = false;
    setDiscardingVoice(true);
    voice.cancel();
    videoNote.cancel();
    // Clear immediately; the animation must never delay the local draft mutation.
    void media.remove().finally(() => {
      discardRemovalDone.current = true;
      finishVoiceDiscard();
    });
  };
  const updateNavigation = () => onNavigationContextChange({ ...parentNavigation,
    title: parentNavigation?.title ?? 'Обсуждение', onBack: () => back.current() });
  back.current = () => {
    ++viewerRequest.current;
    if (savingVideo) { setSavingVideo(null); updateNavigation(); return; }
    if (cameraOpen) { setCameraOpen(false); updateNavigation(); return; }
    if (attachmentsOpen) { setAttachmentsOpen(false); updateNavigation(); return; }
    if (speedOpen) { setSpeedOpen(false); updateNavigation(); return; }
    if (videoFullscreen) { setFullscreenVideo(null); updateNavigation(); return; }
    if (viewer) { setViewing(null); updateNavigation(); return; }
    if (circleInProgress) { videoNote.cancel(); updateNavigation(); return; }
    if (previewing || voiceComposer || circleDraft) {
      if (removingVoice.current) { updateNavigation(); return; }
      if (voiceInProgress) voice.cancel();
      else closePreview();
      // Back may consume the browser entry while cancellation or removal is pending.
      updateNavigation();
      return;
    }
    if (deleting) { setDeleting(null); return; }
    if (menu?.open) { closeMenu(); return; }
    if ((replyId || editId) && !outgoing) { cancelMode(); return; }
    (onBack ?? onClose)();
  };
  useEffect(() => {
    // Preserve the underlying entity and its scroll identity; no independent history/Back listeners.
    updateNavigation();
    return () => onNavigationContextChange(parentNavigation);
  }, [onNavigationContextChange, parentNavigation, session, mediaSurfaceOpen, savingVideo]);
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
  }, [replyId, editId, error, draft.error, syncState?.status, syncState?.offline, previewing, media.phase, media.error, voice.status, voice.error, voice.permissionReady, voiceDraft, videoNote.status, videoNote.error, videoNote.permissionReady, circleDraft]);

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
  }, [state.messages, published, outgoing, media.preview, requestedFocus, atEnd, composerHeight, contextHeight]);
  const markViewed = (id: string) => {
    lastRead.current = id;
    void repository.markRead(threadId, id).then(() => {
      if (alive.current) setReadError(false);
    }, () => {
      if (alive.current) { lastRead.current = null; setReadError(true); }
    });
  };
  useEffect(() => {
    if (mediaSurfaceOpen || !visible || focusing.current || state.loading || state.error || requestedFocus) return;
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
  }, [atEnd, visible, readPosition, state.messages, state.loading, state.error, requestedFocus, mediaSurfaceOpen, repository, threadId, composerHeight, contextHeight, syncState?.status, syncState?.offline]);

  useEffect(() => {
    if (menu && !(menu.id === outgoing?.id && outgoingStatus === 'failed' && outgoingVideo)
      && !state.messages.some(row => row.id === menu.id && !row.deleted)) setMenu(null);
    if (editId && state.messages.some(row => row.id === editId && row.deleted)) {
      setEditId(null); setEditText(''); setError('Сообщение уже удалено');
    }
  }, [state.messages, menu?.id, editId, outgoing?.id, outgoingStatus, outgoingVideo]);
  const run = async (operation: () => Promise<void>) => {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError(null);
    const version = ++actionVersion.current;
    try { await operation(); }
    catch { if (alive.current && version === actionVersion.current) setError('Не удалось выполнить действие. Повторите попытку'); }
    finally { pending.current = false; if (alive.current && version === actionVersion.current) setBusy(false); }
  };
  const openVideoPosition = (messageId: string, position: DiscussionVideoPosition) => void run(async () => {
    const request = ++viewerRequest.current;
    const original = await repository.getMessage(threadId, messageId).catch(() => null);
    if (!alive.current || request !== viewerRequest.current) return;
    const attachment = original && !original.deleted && original.attachments?.find(item =>
      item.id === position.attachmentId && item.mediaType === 'video');
    const source = attachment && galleryMediaSource(attachment, repository.actorUserId);
    if (!source) { setError('Исходное видео недоступно'); return; }
    setFullscreenVideo(null);
    setViewing({ messageId, attachmentId: position.attachmentId, startAt: position.seconds, source });
  });
  const submit = () => {
    if (cameraOpen || pending.current || mediaBusy || outgoing) return;
    if (!editId && mediaPresent) { void media.send(); return; }
    void run(async () => {
      if (!text.trim()) return;
      if (editId) await repository.edit(threadId, editId, text);
      else {
        const command = draft.command();
        if (!prepared.current || prepared.current.id !== command.id || prepared.current.text !== text
          || prepared.current.replyToMessageId !== (replyId ?? undefined)
          || !sameDiscussionVideoPosition(prepared.current.replyVideoPosition, command.replyVideoPosition)) prepared.current = command;
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
    if (!selected || !menuRef.current?.open || menuRef.current.id !== selected.id || pending.current || mediaBusy || voiceComposer || circleInProgress) return;
    const id = selected.id; closeMenu();
    const row = session.snapshot().messages.find(message => message.id === id && !message.deleted);
    if (!row) return;
    if (action === 'reply' && !draft.videoPosition) {
      // Selecting Reply is an explicit viewing action even away from the end.
      if (row.authorUserId !== repository.actorUserId) markViewed(row.id);
      draft.update(draft.text, id); setEditId(null); setEditText('');
    }
    if (action === 'edit' && row.authorUserId === repository.actorUserId) { setEditId(id); setEditText(row.text); }
    if (action === 'delete' && row.authorUserId === repository.actorUserId) setDeleting({ id, kind: 'published' });
    if (action === 'copy') void run(async () => {
      const current = await repository.getMessage(threadId, id);
      if (!alive.current || current.deleted) return;
      if (!navigator.clipboard?.writeText) throw new Error('CLIPBOARD_UNAVAILABLE');
      await navigator.clipboard.writeText(current.text);
    });
  };
  const own = selected?.authorUserId === repository.actorUserId;
  const outgoingMenu = Boolean(menu && outgoing?.id === menu.id && outgoingStatus === 'failed' && outgoingVideo);
  const saveItem = (attachmentId: string, target: DiscussionVideoSaveTarget): LiquidPopoverItem => ({
    id: 'save-video-' + attachmentId, label: 'Сохранить', icon: 'arrow-down', onSelect: () => {
      if (!menuRef.current?.open || menuRef.current.id !== menu?.id) return;
      closeMenu();
      setVideoSaveNotice('');
      setSavingVideo(target);
    },
  });
  const items: LiquidPopoverItem[] = outgoingMenu && outgoingVideo
    ? [saveItem(outgoingVideo.metadata.id, { file: outgoingVideo.file })] : [
    ...(!draft.videoPosition ? [{ id: 'reply', label: 'Ответить', icon: 'arrow-back-up' as const, onSelect: () => choose('reply') }] : []),
    ...(own && selected?.text.trim() && !mediaPresent ? [{ id: 'edit', label: 'Редактировать', icon: 'edit' as const, onSelect: () => choose('edit') }] : []),
    ...(selected?.text.trim() ? [{ id: 'copy', label: 'Копировать', icon: 'copy' as const, onSelect: () => choose('copy') }] : []),
    ...(selected?.attachments ?? []).flatMap(attachment => {
      if (attachment.mediaType !== 'video' && attachment.mediaType !== 'video-note') return [];
      const { storageKey, mimeType, sizeBytes } = attachment;
      const url = storageKey && directMediaUrl(storageKey);
      if (!url || !storageKey) return [];
      return [saveItem(attachment.id, { url, cache: { accountId: repository.actorUserId, storageKey, mimeType, sizeBytes } })];
    }),
    ...(own ? [{ id: 'delete', label: 'Удалить', icon: 'trash' as const, onSelect: () => choose('delete') }] : []),
  ];
  const renderMessageMenu = (id: string) => menu?.id === id && <span onClick={event => event.stopPropagation()}>
    <LiquidPopover key={id} triggerRef={trigger} triggerActivation="controlled" isOpen={menu.open}
      onOpenChange={open => {
        if (menuRef.current?.id !== id) return;
        menuRef.current = { ...menuRef.current, open }; setMenu(menuRef.current);
      }}
      onPresentationChange={presented => { if (!presented) setMenu(current => current?.id === id && !current.open ? null : current); }}
      layout="menu" label="Действия сообщения" items={items} {...material}
      trigger={<button type="button" ref={trigger} aria-hidden="true" tabIndex={-1} className="discussion-menu-source" />} />
  </span>;
  const replying = replyId ? state.messages.find(row => row.id === replyId) : undefined;
  const replyQuote: DiscussionQuote | null = replyId && !draft.videoPosition ? { messageId: replyId,
    authorUserId: replying?.authorUserId ?? null, deleted: Boolean(replying?.deleted), unavailable: !replying,
    text: replying && !replying.deleted ? replying.text.split(/\r?\n/, 1)[0] : '' } : null;

  const commentOnFrame = viewing && viewer?.type === 'video' && !localVideoUrl && canCompose && !editId
    && !draft.videoPosition && !voiceComposer && !circleInProgress
    ? (seconds: number) => {
      if (pending.current) return;
      if (!videoCommentUsed) {
        setVideoCommentUsed(true);
        try { localStorage.setItem(videoCommentHintKey, 'true'); }
        catch { /* Browser storage may be unavailable; keep the flag for this open discussion. */ }
      }
      draft.update(draft.text, viewing.messageId, { attachmentId: viewing.attachmentId, seconds });
      setFullscreenVideo(null);
      setViewing(null);
    } : undefined;
  const composerVideoPosition = replyId && draft.videoPosition
    ? { messageId: replyId, position: draft.videoPosition } : null;

  const pickAttachment = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (file) void media.choose(file);
  };
  const canAttach = canCompose && !voiceComposer && !circleInProgress && !mediaPresent && !editId;
  // LiquidPopover keeps its displayed item snapshot through the animation.
  const canAttachNow = useRef(canAttach);
  canAttachNow.current = canAttach;
  const attachmentItems: LiquidPopoverItem[] = [
    { id: 'photo', icon: 'photo', label: 'Фото', onSelect: () => {
      if (!canAttachNow.current || pending.current) return;
      setAttachmentsOpen(false);
      photoPicker.current?.click();
    } },
    { id: 'video', icon: 'video', label: 'Видео', onSelect: () => {
      if (!canAttachNow.current || pending.current) return;
      setAttachmentsOpen(false);
      videoNote.release();
      voice.cancel();
      setCameraOpen(true);
    } },
  ];

  return <div className="discussion-thread" data-thread-id={threadId} data-focus-message-id={focusMessageId}
    data-show-avatars={String(showAvatars)}>
    <header className="discussion-thread__header" inert={mediaSurfaceOpen}>
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
    <div className="discussion-thread__scroll" ref={scroller} inert={mediaSurfaceOpen} style={{ paddingBottom: composerHeight + contextHeight + 16 }}
      onScroll={event => { const el = event.currentTarget; setAtEnd(el.scrollHeight - el.scrollTop - el.clientHeight < 48); rememberPosition(); setReadPosition(value => value + 1); closeMenu(); }}>
      {state.error && <div role="alert"><Text>{state.error}</Text><Button rounded onClick={() => { setError(null); deepFocus.current = null; session.retry(); }}>Повторить</Button></div>}
      {state.more && <Button rounded disabled={state.loading || Boolean(state.error)} onClick={() => {
        const el = scroller.current;
        if (el) preserveScroll.current = { height: el.scrollHeight, top: el.scrollTop };
        session.loadMore();
      }}>Загрузить ещё</Button>}
      {state.loading && <Text variant="caption" role="status">Загрузка сообщений…</Text>}
      <Messages>
        {renderedMessages.map((message, index) => {
          const author = showAvatars ? resolveAuthor(message.authorUserId) : null;
          const isOwn = message.authorUserId === repository.actorUserId;
          const cursorKey = discussionCursorKey({ id: message.id, createdAt: message.createdAt });
          const isRead = isOwn && receipts.recipientReadThrough.some(cursor => (!cursor.threadId || cursor.threadId === message.threadId) && discussionCursorKey(cursor) >= cursorKey);
          const isConfirmed = isOwn && receipts.confirmedIds.includes(message.id);
          const receiptIcon = isRead ? 'message-double-check' : isConfirmed ? 'message-check' : null;
          const time = new Date(message.createdAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
          const day = new Date(message.createdAt).toLocaleDateString('ru-RU');
          const attachments = message.deleted ? [] : (message.attachments ?? []).filter(attachment =>
            attachment.storageKey && directMediaUrl(attachment.storageKey));
          const mediaOnly = attachments.length > 0 && !message.text.trim();
          const galleryOnly = mediaOnly && attachments.every(attachment => attachment.mediaType !== 'voice');
          const metadata = <span className="discussion-message-meta"><Text variant="caption">{time}</Text>
            {receiptIcon && <span className="discussion-message-meta__check" role="img"
              aria-label={isRead ? 'Прочитано собеседником' : 'Отправка подтверждена Dexie Cloud'}>
              <Icon name={receiptIcon} /></span>}
          </span>;
          const openMenu = () => {
            if (!message.deleted && !pending.current && !mediaBusy && !outgoing && !voiceComposer && !circleInProgress) {
              setMenu({ id: message.id, open: true });
            }
          };
          return <Fragment key={message.id}>
            {(index === 0 || new Date(renderedMessages[index - 1].createdAt).toLocaleDateString('ru-RU') !== day) && <MessagesTitle>{day}</MessagesTitle>}
            <div className="discussion-message-target" data-message-id={message.id} data-own={String(isOwn)}
              data-highlighted={highlight === message.id || undefined}
              ref={el => { if (el) rows.current.set(message.id, el); else rows.current.delete(message.id); }}>
              <MezfitMessage type={isOwn ? 'sent' : 'received'} focusPulse={highlight === message.id}
                bubbleVariant={galleryOnly ? 'media' : undefined}
                name={showAvatars && author ? <Text variant="caption">{author.name}</Text> : undefined}
                avatar={showAvatars && author ? <Avatar name={author.name} src={author.avatarSrc} size="small" /> : undefined}
                text={!mediaOnly && <Text variant="chat" className="discussion-message-text">{message.deleted ? 'Сообщение удалено' : message.text}</Text>}
                textHeader={message.reply && <Quote quote={message.reply} resolveAuthor={resolveAuthor} onJump={() => {
                  const reply = message.reply;
                  if (!reply) return;
                  if (reply.videoPosition) openVideoPosition(reply.messageId, reply.videoPosition);
                  else void jump(reply.messageId);
                }} />}
                textFooter={!message.deleted && (message.attachments?.length ? attachments.map((attachment, position) => {
                  const meta = mediaOnly && position === attachments.length - 1 ? metadata : undefined;
                  const onMenu = position === 0 ? openMenu : undefined;
                  if (attachment.mediaType === 'voice' && attachment.storageKey) {
                    const { storageKey, mimeType, sizeBytes, waveform, durationSeconds } = attachment;
                    const src = directMediaUrl(storageKey);
                    return src && <DiscussionVoice key={attachment.id} src={src} waveform={waveform ?? []}
                      durationMs={(durationSeconds ?? 0) * 1000} meta={meta} onMenu={onMenu}
                      cache={{ accountId: repository.actorUserId, storageKey, mimeType, sizeBytes }} />;
                  }
                  if (attachment.mediaType === 'video-note' && attachment.storageKey) {
                    const { storageKey, mimeType, sizeBytes, durationSeconds } = attachment;
                    const src = directMediaUrl(storageKey);
                    return src && <DiscussionVideoNote key={attachment.id} src={src}
                      durationSeconds={durationSeconds ?? 0} playbackHost={videoPlaybackHost} meta={meta} onMenu={onMenu}
                      cache={{ accountId: repository.actorUserId, storageKey, mimeType, sizeBytes }} />;
                  }
                  const source = galleryMediaSource(attachment, repository.actorUserId);
                  return source && <DiscussionMedia key={attachment.id} {...source} mode="thumbnail"
                    onOpen={() => { closeMenu(); openViewer(message.id, attachment.id); }}
                    onMenu={onMenu} meta={meta} />;
                }) : renderAttachment?.(message))}
                inlineMeta={mediaOnly ? undefined : metadata}
                onBubbleClick={openMenu}
                bubbleSource={renderMessageMenu(message.id)}
              />
            </div>
          </Fragment>;
        })}
        {outgoing && outgoingStatus && media.selection && media.preview
          && !renderedMessages.some(message => message.id === outgoing.id) && <Fragment key={outgoing.id}>
          {new Date(renderedMessages.at(-1)?.createdAt ?? 0).toLocaleDateString('ru-RU') !==
            new Date(outgoing.createdAt).toLocaleDateString('ru-RU') && <MessagesTitle>
            {new Date(outgoing.createdAt).toLocaleDateString('ru-RU')}
          </MessagesTitle>}
          <div className="discussion-message-target" data-own="true" data-message-id={outgoing.id}>
            <DiscussionOutgoingMedia src={media.preview} attachment={media.selection.metadata} createdAt={outgoing.createdAt}
              status={outgoingStatus} error={media.error} onCancel={media.cancel}
              onRetry={() => void media.send()}
              onRemove={outgoingVideo ? () => setDeleting({ id: outgoing.id, kind: 'outgoing-video' }) : () => void media.remove()}
              onOpen={outgoingVideo?.metadata.mediaType === 'video' ? () => {
                closeMenu();
                openViewer(outgoing.id, outgoing.attachmentId);
              } : undefined}
              onMenu={outgoingVideo && outgoingStatus === 'failed' ? () => setMenu({ id: outgoing.id, open: true }) : undefined}
              menu={renderMessageMenu(outgoing.id)} />
          </div>
        </Fragment>}
      </Messages>
    </div>
    {previewing && media.preview && media.selection && media.selection.metadata.mediaType !== 'voice' && media.selection.metadata.mediaType !== 'video-note' &&
      <DiscussionMediaStage label="Предпросмотр вложения" fullscreen={Boolean(previewVideoUrl && !viewer && videoFullscreen)}
        style={{ bottom: composerHeight + contextHeight }}>
        <DiscussionMedia key={media.preview} src={media.preview} type={media.selection.metadata.mediaType} mode="preview" playbackRate={videoSpeed} />
        {previewVideoUrl && !viewer && <div className="discussion-media-stage__close">{speedMenu}{fullscreenButton}</div>}
      </DiscussionMediaStage>}
    {viewer && <DiscussionMediaStage label="Просмотр вложения" className="discussion-media-stage--viewer"
      fullscreen={viewer.type === 'video' && videoFullscreen}>
      <DiscussionMedia key={`${viewer.src}:${viewing?.startAt ?? ''}`} {...viewer} mode="viewer"
        autoPlay={Boolean(localVideoUrl)} startAt={viewing?.startAt} onComment={commentOnFrame} showCommentHint={!videoCommentUsed}
        playbackRate={videoSpeed} />
      <div className="discussion-media-stage__close">
        {speedMenu}
        {fullscreenButton}
        <IconButton icon="x" label="Закрыть просмотр" onClick={() => {
          setFullscreenVideo(null);
          setViewing(null);
        }} />
      </div>
    </DiscussionMediaStage>}
    {cameraOpen && <DiscussionVideoRecorder onCancel={() => setCameraOpen(false)}
      onGallery={() => {
        setCameraOpen(false);
        gallery.current?.click();
      }}
      onUse={file => {
        setCameraOpen(false);
        void media.choose(file);
      }} />}
    <div className="discussion-composer-context" ref={context} inert={Boolean(viewer) || cameraOpen || videoFullscreen}
      data-previewing={previewing || undefined} style={{ bottom: composerHeight }}>
      {receiptError && <><Text variant="footnote" role="alert">Не удалось обновить статусы прочтения</Text>
        <Button rounded onClick={() => setReceiptRetry(value => value + 1)}>Повторить обновление статусов</Button></>}
      {readError && <><Text variant="footnote" role="alert">Не удалось отметить сообщения прочитанными</Text>
        <Button rounded onClick={() => setReadPosition(value => value + 1)}>Повторить отметку прочтения</Button></>}
      {error && <Text variant="footnote" role="alert">{error}</Text>}
      {voice.error && <Text variant="footnote" role="alert">{voice.error}</Text>}
      {videoNote.error && <Text variant="footnote" role="alert">{videoNote.error}</Text>}
      {videoNote.status === 'requesting' && <Text variant="footnote" role="status">Разрешите камеру и микрофон, затем удерживайте кнопку кружка</Text>}
      {videoNote.permissionReady && actionMode === 'camera' && <Text variant="footnote" role="status">Камера доступна. Удерживайте кнопку для записи</Text>}
      {voice.status === 'requesting' && <Text variant="footnote" role="status">Разрешите доступ к микрофону, затем удерживайте кнопку записи</Text>}
      {voice.permissionReady && actionMode === 'microphone' && <Text variant="footnote" role="status">Микрофон доступен. Удерживайте кнопку для записи</Text>}
      {voice.status === 'processing' && <Text variant="footnote" role="status">Готовим голосовое сообщение…</Text>}
      {media.error && !outgoing && <Text variant="footnote" role="alert">{media.error}</Text>}
      {media.phase === 'checking' && <Text variant="footnote" role="status">Проверяем файл…</Text>}
      {mediaPresent && <div className="discussion-composer-context__mode">
        {!previewing && !voiceDraft && !circleDraft && <Text variant="footnote" className="discussion-media-filename">{activeAttachment?.fileName}</Text>}
        {circleDraft ? <>
          {!media.selection && <Text variant="footnote" role="alert">Запись кружка недоступна на этом устройстве. Удалите черновик и запишите заново.</Text>}
          <IconButton icon="x" label="Убрать видеокружок" disabled={busy || mediaBusy} onClick={closePreview} />
        </> : !voiceDraft && <>
          {!media.selection && draft.media && <Button rounded disabled={busy || mediaBusy} onClick={() => gallery.current?.click()}>
            <Text variant="footnote">Выбрать файл снова</Text>
          </Button>}
          <IconButton icon="x" label="Убрать вложение" disabled={busy || mediaBusy} onClick={closePreview} />
        </>}
      </div>}
      {draft.error && <><Text variant="footnote" role="alert">{draft.error}</Text>
        <Button rounded disabled={busy} onClick={draft.retry}>Повторить сохранение черновика</Button></>}
      {syncState?.status === 'error' && <Button rounded disabled={busy} onClick={() => void run(() => repository.sync.retry())}>Повторить синхронизацию</Button>}
      {(replyQuote || editId) && <div className="discussion-composer-context__mode">
        {replyQuote ? <Quote quote={replyQuote} resolveAuthor={resolveAuthor} onJump={() => void jump(replyQuote.messageId)} /> : <Text variant="footnote">Редактирование сообщения</Text>}
        <IconButton icon="x" label="Отменить ответ или редактирование" disabled={busy || mediaBusy || Boolean(outgoing)}
          onClick={cancelMode} />
      </div>}
    </div>
    <div ref={setVideoPlaybackHost} className="discussion-video-note-live discussion-video-note-playback"
      style={{ bottom: composerHeight + contextHeight + 12 }} />
    {circleDraft && media.preview && !mediaBusy && <DiscussionVideoNote key={media.preview} src={media.preview}
      durationSeconds={circleDraft.durationSeconds ?? 0} playbackHost={videoPlaybackHost} review />}
    {(recordingCircle || videoNote.status === 'processing') && <div className="discussion-video-note-live"
      style={{ bottom: composerHeight + contextHeight + 12 }}>
      <DiscussionVideoNoteCapture stream={videoNote.stream} progress={videoNote.progress} />
    </div>}
    {repository.supportsMedia && <>
      <input type="file" hidden ref={gallery} accept={DISCUSSION_MEDIA_ACCEPT} onChange={pickAttachment} />
      <input type="file" hidden ref={photoPicker} accept={DISCUSSION_MEDIA_ACCEPT.split(',').filter(type => type.startsWith('image/')).join(',')}
        onChange={pickAttachment} />
    </>}
    <div className="discussion-composer" ref={composer} inert={Boolean(viewer) || cameraOpen || videoFullscreen} data-previewing={previewing || undefined}>
      <GlassSurface ref={addSurface} className="discussion-composer__button discussion-composer__button--add" {...material}
        shape="capsule" wrapContent={false} style={{ visibility: !voiceComposer && attachmentsPresented ? 'hidden' : undefined }}>
        {voiceComposer || circleInProgress || circleDraft
          ? <IconButton color="red" label={circleInProgress || circleDraft ? "Удалить видеокружок" : "Удалить голосовое сообщение"}
            disabled={!canCompose || discardingVoice} onPointerDown={event => event.preventDefault()} onClick={discardVoice}>
            {!discardingVoice && <DiscussionVoiceTrash deleting={false} onComplete={() => {}} />}
          </IconButton>
          : !repository.supportsMedia
          ? <IconButton icon="paperclip" label="Добавить вложение (пока недоступно)" disabled />
          : <LiquidPopover isOpen={attachmentsOpen} onOpenChange={setAttachmentsOpen} triggerRef={addSurface}
            onPresentationChange={setAttachmentsPresented} layout="menu" label="Вложения" items={attachmentItems} {...material}
            trigger={<IconButton icon="paperclip"
              label="Добавить вложение" disabled={!canAttach}
              onPointerDown={() => {
                const surface = addSurface.current;
                if (typeof surface?.animate === 'function') startPressScale(surface, 1.5);
              }} />} />}
        {discardingVoice && <span className="discussion-composer__trash-animation" aria-hidden="true">
          <DiscussionVoiceTrash deleting onComplete={() => {
            discardAnimationDone.current = true;
            finishVoiceDiscard();
          }} />
        </span>}
      </GlassSurface>
      <GlassSurface className="discussion-composer__field" {...material} shape={{ radius: 24 }} wrapContent={false}>
        {composerVideoPosition && <BadgeChoice className="discussion-composer__timecode" color="yellow"
          disabled={busy || voiceInProgress || circleInProgress} onClick={() => openVideoPosition(composerVideoPosition.messageId, composerVideoPosition.position)}>
          {formatVideoPosition(composerVideoPosition.position.seconds)}
        </BadgeChoice>}
        {!discardingVoice && (recordingVoice || recordingCircle) ? <DiscussionRecordingStatus locked={lockedRecording} onCancel={discardVoice} />
          : !discardingVoice && voiceDraft && media.preview ? <DiscussionVoice key={media.preview} src={media.preview}
            waveform={voiceDraft.waveform ?? []} durationMs={(voiceDraft.durationSeconds ?? 0) * 1000} />
          : !discardingVoice && voiceDraft ? <Text variant="footnote" className="discussion-composer__voice-placeholder">
            {media.selection ? 'Готовим голосовое сообщение…' : 'Голосовое сообщение'}
          </Text>
          : <MezfitMessagebar bare textareaId={textareaId} className={composerVideoPosition ? 'discussion-composer__timecode-input' : undefined}
            placeholder={circleInProgress || circleDraft ? '' : editId ? 'Редактировать сообщение' : 'Сообщение'}
            value={text} maxRows={5} disabled={!canCompose || voiceInProgress || circleInProgress || Boolean(circleDraft) || discardingVoice}
            onChange={(event: ChangeEvent<HTMLTextAreaElement>) => setText(event.target.value)} />}
      </GlassSurface>
      {holdingRecording && <div className="discussion-composer__recording-control" data-locked={lockedRecording || undefined}
        style={{ bottom: lockedRecording ? 88 : RECORDING_LOCK_DISTANCE }}>
        <GlassSurface className="discussion-composer__button" {...material} shape="capsule" wrapContent={false}>
          {lockedRecording
            ? <IconButton icon="player-stop" label="Остановить запись" onClick={recordingGesture.stop} />
            : <IconButton icon="lock" label="Сдвиньте вверх до замка" />}
        </GlassSurface>
      </div>}
      <GlassSurface ref={actionSurface} className="discussion-composer__button discussion-composer__action" {...material}
        data-recording={holdingRecording || undefined} shape="capsule" wrapContent={false}>
        <IconButton label={actionMode === 'send'
          ? (editId ? 'Сохранить' : 'Отправить')
          : actionMode === 'microphone' ? 'Переключить на кружок' : 'Переключить на голосовое'}
          aria-description={repository.supportsMedia && actionMode === 'microphone' ? 'Удерживайте для записи голосового'
            : repository.supportsMedia && actionMode === 'camera' ? 'Удерживайте для записи видеокружка' : undefined}
          className={actionMode === 'microphone' || actionMode === 'camera' ? 'discussion-composer__microphone' : undefined}
          disabled={!canCompose || attachmentsOpen || discardingVoice || voice.status === 'processing' || videoNote.status === 'processing'
            || (actionMode === 'send' && !lockedRecording && (mediaPresent ? !media.selection : !text.trim()))}
          onPointerDown={event => {
            // The chat material owns the continuous scale; suppress the primitive's second press animation.
            event.preventDefault();
            const surface = actionSurface.current;
            if (((actionMode === 'send' && !lockedRecording) || !repository.supportsMedia)
              && typeof surface?.animate === 'function') startPressScale(surface, 1.5);
            voice.onPointerDown(event, actionMode === 'microphone' && !circleInProgress && !mediaPresent && Boolean(repository.supportsMedia));
            videoNote.onPointerDown(event, actionMode === 'camera' && !voiceInProgress && !mediaPresent && Boolean(repository.supportsMedia));
          }}
          onPointerMove={event => { voice.onPointerMove(event); videoNote.onPointerMove(event); }}
          onPointerUp={event => { voice.onPointerUp(event); videoNote.onPointerUp(event); }}
          onPointerCancel={event => { voice.onPointerCancel(event); videoNote.onPointerCancel(event); }}
          onLostPointerCapture={event => { voice.onPointerCancel(event); videoNote.onPointerCancel(event); }}
          onContextMenu={event => { if (actionMode === 'microphone' || actionMode === 'camera') event.preventDefault(); }}
          onClick={event => {
            const voiceConsumed = voice.consumeClick();
            const circleConsumed = videoNote.consumeClick();
            if ((voiceConsumed || circleConsumed) && event.detail !== 0) return;
            if (lockedRecording) recordingGesture.send();
            else if (actionMode === 'send') submit();
            else setMediaMode(current => current === 'microphone' ? 'camera' : 'microphone');
          }}>
          <DiscussionActionIcon mode={actionMode} />
        </IconButton>
      </GlassSurface>
    </div>
    {savingVideo && <DiscussionVideoSaveDialog target={savingVideo} onClose={() => setSavingVideo(null)} onStatus={setVideoSaveNotice} />}
    {videoSaveNotice && <Toast opened position="center" role="status"><Text variant="body">{videoSaveNotice}</Text></Toast>}
    <MezfitDialog opened={Boolean(deleting)} aria-hidden={deleting ? undefined : true} inert={deleting ? undefined : true}
      title={<Text variant="headline">{deletingOutgoingVideo ? 'Убрать неотправленное видео?' : 'Удалить сообщение?'}</Text>}
      content={<Text>{deletingOutgoingVideo
        ? 'Видео исчезнет из чата. Перед удалением можно сохранить копию на устройство.'
        : 'Сообщение будет удалено из переписки.'}</Text>} onBackdropClick={() => { if (!busy) setDeleting(null); }}
      buttons={<><MezfitDialogButton disabled={busy} onClick={() => setDeleting(null)}><Text>Отмена</Text></MezfitDialogButton>
        <MezfitDialogButton strong tone="danger" disabled={busy} onClick={() => {
          if (!deleting) return;
          if (deleting.kind === 'outgoing-video') {
            if (deleting.id === outgoing?.id && outgoingStatus === 'failed') void media.remove();
            setDeleting(null);
            return;
          }
          void run(async () => { await repository.remove(threadId, deleting.id); if (alive.current) setDeleting(null); });
        }}><Text>Удалить</Text></MezfitDialogButton></>} />
  </div>;
}
