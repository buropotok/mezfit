import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentProps } from 'react';
import { createPortal } from 'react-dom';
import { Button } from 'konsta/react';
import type { NavigationContext } from '../NavigationShell';
import { useDiscussionAvatarFlight, type AvatarFlightOrigin, discussionAvatarFlightKey } from '../navigation/DiscussionAvatarFlightContext';
import { useNavigationSurfaceContext } from '../navigation/NavigationSurfaceContext';
import { useCloudConnections } from '../data/cloud/CloudConnectionsProvider';
import { syncStatusLabel } from '../data/cloud/sync-status';
import { DiscussionRepository, observeDiscussionNotificationThread } from '../data/cloud/discussions';
import { discussionOrganizationCode, type AssignableDiscussionCategory } from '../data/cloud/discussion-organization';
import { CloudContactAvatar } from '../contacts/CloudContactAvatar';
import { Avatar, Badge, DatePicker, Icon, List, ListItem, Text, type LocalDate } from '../ui';
import { LiquidGlassTextOnly } from '../ui/LiquidGlassTextOnly';
import {
  categoryDialogTitle, categoryMutationError, categoryTabValue, discussionCategoryTabs,
  DiscussionCategoryDialog, DiscussionCategoryMenu, DiscussionMoveMenu,
  type CategoryDialogIntent,
} from './DiscussionCategoryControls';
import { DiscussionSheet } from './DiscussionSheet';
import { DiscussionEntity } from './DiscussionEntity';
import { DiscussionContactPicker, DiscussionsDestinationFab, DiscussionWorkspaceFab, FreeDiscussionTitleDialog } from './FreeDiscussionCreationControls';
import { useDiscussions, type DiscussionInboxRow } from './DiscussionsProvider';
import { useDiscussionOrganization } from './useDiscussionOrganization';
import { findDiscussionPeer, useFreeDiscussionCreation } from './useFreeDiscussionCreation';
import { discussionDateLabel, discussionLocalDate, groupDiscussionFeed } from './feed-presentation';
import { ScheduleClientFilter } from '../schedule/ScheduleClientFilter';
import { ScheduleFilterBar } from '../schedule/ScheduleFilterBar';
import type { EntityDiscussionAnchor } from '../../shared/discussion-anchor';
import './discussions-page.css';

const entityActionLabels = {
  program: 'К программе', workout: 'К тренировке', exercise: 'К упражнению', set: 'К подходу',
} satisfies Record<EntityDiscussionAnchor['kind'], string>;

type DiscussionMoveActions = ComponentProps<typeof DiscussionMoveMenu>['actions'] & {
  remove: (row: DiscussionInboxRow) => void;
  move: (row: DiscussionInboxRow, category: AssignableDiscussionCategory | null) => void;
};

type InboxOpening = {
  row: DiscussionInboxRow;
  parent: NavigationContext | null;
  messageId?: string;
  avatarSrc?: string;
  flightKey?: string;
} & ({ kind: 'chat' | 'entity' | 'notification' } | { kind: 'created'; scope: object });

function DiscussionInboxItem({ row, onOpen, onEntity, onOpenOrigin, onAvatarSourceChange, hiddenAvatarKey, moveActions }: {
  row: DiscussionInboxRow;
  onOpen: (row: DiscussionInboxRow) => void;
  onEntity: (row: DiscussionInboxRow) => void;
  onOpenOrigin?: (row: DiscussionInboxRow, origin: AvatarFlightOrigin) => void;
  onAvatarSourceChange?: (row: DiscussionInboxRow, src: string | undefined) => void;
  hiddenAvatarKey?: string;
  moveActions?: DiscussionMoveActions;
}) {
  const avatarRef = useRef<HTMLSpanElement>(null);
  const avatarSrc = useRef<string | undefined>(undefined);
  const onSourceChange = useCallback((src: string | undefined) => {
    avatarSrc.current = src;
    onAvatarSourceChange?.(row, src);
  }, [onAvatarSourceChange, row]);
  const key = discussionAvatarFlightKey(row.thread.realmId, row.thread.anchorKey);

  const kind = row.thread.anchor.kind;
  const entityAction = kind === 'free' ? undefined : entityActionLabels[kind];

  return <ListItem
    leading={<span ref={avatarRef} className="discussion-inbox__avatar-source"
      style={hiddenAvatarKey === key ? { visibility: 'hidden' } : undefined}>
      {row.contact ? <CloudContactAvatar contact={row.contact} onSourceChange={onSourceChange} /> : <Avatar name="Вы" />}
    </span>}
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
    onClick={() => {
      const rect = avatarRef.current?.getBoundingClientRect();
      if (rect && rect.width > 0 && rect.height > 0) {
        onOpenOrigin?.(row, {
          key, avatar: { name: row.contact?.displayName ?? 'Вы', src: avatarSrc.current },
          source: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
        });
      }
      onOpen(row);
    }}
    trailingAction={entityAction || moveActions ? <>
      {entityAction ? <Button rounded tonal inline aria-label={`${entityAction}: ${row.thread.derivedTitleSnapshot}`}
        onClick={() => onEntity(row)}><Text variant="caption">{entityAction}</Text></Button> : null}
      {moveActions ? <DiscussionMoveMenu title={row.thread.derivedTitleSnapshot} free={kind === 'free'}
        actions={moveActions} onMove={category => moveActions.move(row, category)}
        onDelete={() => moveActions.remove(row)} /> : null}
    </> : undefined}
  />;
}

/** List actions are siblings through ListItem.trailingAction, never nested buttons. */
export function DiscussionInboxList({ rows, onOpen, onEntity, onOpenOrigin, onAvatarSourceChange, hiddenAvatarKey, moveActions }: {
  rows: readonly DiscussionInboxRow[];
  onOpen: (row: DiscussionInboxRow) => void;
  onEntity: (row: DiscussionInboxRow) => void;
  onOpenOrigin?: (row: DiscussionInboxRow, origin: AvatarFlightOrigin) => void;
  onAvatarSourceChange?: (row: DiscussionInboxRow, src: string | undefined) => void;
  hiddenAvatarKey?: string;
  moveActions?: DiscussionMoveActions;
}) {
  return <>{groupDiscussionFeed(rows).map(group => <section className="discussion-inbox__group" key={group.date} aria-label={group.date || 'Без сообщений'}>
    <Text variant="footnote">{group.date ? discussionDateLabel(group.date) : 'Без сообщений'}</Text>
    <List divider="full">{group.rows.map(row => <DiscussionInboxItem key={row.thread.id}
      row={row} onOpen={onOpen} onEntity={onEntity} onOpenOrigin={onOpenOrigin}
      onAvatarSourceChange={onAvatarSourceChange} hiddenAvatarKey={hiddenAvatarKey} moveActions={moveActions} />)}</List>
  </section>)}</>;
}

export function DiscussionsPage({ role, relationshipId, notificationMessageId, onNotificationOpened, onNavigationContextChange }: {
  role: 'coach' | 'client'; relationshipId?: string;
  notificationMessageId?: string | null; onNotificationOpened?: () => void;
  onNavigationContextChange: (value: NavigationContext | null) => void;
}) {
  const cloud = useCloudConnections();
  const inbox = useDiscussions();
  const avatarFlight = useDiscussionAvatarFlight();
  const capturedOrigin = useRef<AvatarFlightOrigin | null>(null);
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
    avatarFlight.cancel();
    capturedOrigin.current = null;
    ++request.current;
    // An explicit tap in the inbox takes precedence over an unresolved deep link.
    if (notificationMessageId) onNotificationOpened?.();
  }, [avatarFlight, notificationMessageId, onNotificationOpened]);
  const db = cloud?.db;
  const actorId = cloud?.actorUserId;
  const organization = useDiscussionOrganization(db, actorId, role, inbox.rows);
  const categoryScope = useMemo(() => ({}), [organization.scope, relationshipId]);
  const [tabSelection, setTabSelection] = useState<{ scope: object; value: string } | null>(null);
  const tabs = discussionCategoryTabs(role, organization.categories);
  const requestedTab = tabSelection?.scope === categoryScope ? tabSelection.value : 'training';
  const activeTab = tabs.some(tab => tab.value === requestedTab) ? requestedTab : 'all';
  const manageCategory = organization.categories.find(category => categoryTabValue({ kind: 'custom', id: category.id }) === activeTab);
  const creationScope = useMemo(() => ({}), [categoryScope, activeTab]);
  const [unavailableCreatedChat, setUnavailableCreatedChat] = useState<object | null>(null);

  const [opened, setOpened] = useState<InboxOpening | null>(null);
  // Keep avatar publication from the feed stable as messages and filters rerender.
  const syncOpenedAvatarSource = useCallback((row: DiscussionInboxRow, src: string | undefined) => {
    const key = discussionAvatarFlightKey(row.thread.realmId, row.thread.anchorKey);
    setOpened(opened => opened?.kind === 'chat'
      && (opened.flightKey ?? discussionAvatarFlightKey(opened.row.thread.realmId, opened.row.thread.anchorKey)) === key
      && opened.avatarSrc !== src ? { ...opened, avatarSrc: src } : opened);
  }, []);
  const activeRow = opened ? inbox.rows.find(row => row.thread.anchorKey === opened.row.thread.anchorKey
    && row.thread.realmId === opened.row.thread.realmId) : undefined;
  const notificationPeers = role === 'coach' ? cloud?.clients : cloud?.coaches;
  const notificationContact = opened?.kind === 'notification' ? notificationPeers?.find(
    contact => contact.relationshipId === opened.row.thread.realmId,
  ) : undefined;
  // Creation has a committed header before the feed can project it. Keep that
  // opening only within the same tab, account, role and verified pair.
  const createdContact = opened?.kind === 'created' && opened.scope === creationScope && opened.row.contact
    && !notificationMessageId ? findDiscussionPeer(notificationPeers ?? [], opened.row.contact) : undefined;
  const current = (opened?.kind === 'notification' ? notificationContact : opened?.kind === 'created' ? createdContact : activeRow) ? opened : null;
  const currentThread = current?.kind === 'created' ? activeRow?.thread ?? current.row.thread : current?.row.thread;
  useLayoutEffect(() => {
    if (opened?.kind === 'created' && !current) setOpened(previous => previous === opened ? null : previous);
  }, [opened, current]);
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
  useEffect(() => () => { avatarFlight.cancel(); openRef.current = false; ++request.current; }, [avatarFlight]);
  const close = useCallback(() => { avatarFlight.cancel(); ++request.current; openRef.current = false; setOpened(null); }, [avatarFlight]);
  const closePicker = useCallback(() => setPicker(null), []);
  const realmId = currentThread?.realmId;
  const coachClientId = currentThread?.coachClientId;
  const repository = useMemo(() => {
    if (!db || !actorId || !realmId || coachClientId === undefined || current?.kind === 'entity') return null;
    try { return new DiscussionRepository(db, actorId, { realmId, coachClientId }); }
    catch { return null; }
  }, [db, actorId, current?.kind, realmId, coachClientId]);
  const notificationRealmsKey = JSON.stringify((notificationPeers ?? []).map(contact => contact.relationshipId).sort());
  const covered = Boolean(current || clientFilter || picker);
  const categorySurface = useMemo(() => ({}), [categoryScope, covered]);
  const activeCategorySurface = useRef<object | null>(null);
  useLayoutEffect(() => {
    activeCategorySurface.current = categorySurface;
    return () => { activeCategorySurface.current = null; };
  }, [categorySurface]);
  const selectCategory = (value: string) => {
    setTabSelection({ scope: categoryScope, value });
    setLimit(50);
  };
  useEffect(() => {
    if (!organization.snapshot || requestedTab === activeTab) return;
    setTabSelection(current => current?.scope === categoryScope && current.value === requestedTab
      ? { scope: categoryScope, value: activeTab } : current);
    setLimit(50);
  }, [activeTab, categoryScope, organization.snapshot, requestedTab]);
  useEffect(() => setLimit(50), [categoryScope]);

  const [categoryDialog, setCategoryDialog] = useState<{
    surface: object;
    intent: CategoryDialogIntent;
    parent: NavigationContext | null;
  } | null>(null);
  const dialog = categoryDialog?.surface === categorySurface && !covered ? categoryDialog : null;
  const runningCategoryAction = useRef<{ scope: object } | null>(null);
  const [categoryFeedback, setCategoryFeedback] = useState<{
    scope: object;
    surface: object;
    pending: boolean;
    error: string;
  } | null>(null);
  const feedback = categoryFeedback?.surface === categorySurface ? categoryFeedback : null;
  const categoryBusy = categoryFeedback?.scope === categoryScope && categoryFeedback.pending;
  const creationCategory: AssignableDiscussionCategory | null = activeTab === 'nutrition' || activeTab === 'personal' ? activeTab
    : manageCategory ? { kind: 'custom', id: manageCategory.id } : null;
  const creation = useFreeDiscussionCreation({ cloud, organization: organization.repository, category: creationCategory,
    scope: creationScope, role, relationshipId, blocked: covered || Boolean(dialog || categoryBusy || notificationMessageId),
    parent, onNavigationContextChange, onStart: () => { cancelPendingOpen(); setOpenError(''); setUnavailableCreatedChat(null); },
    onCreated: (thread, contact, source) => {
      if (!contact) {
        setUnavailableCreatedChat(creationScope);
        return;
      }
      setOpened({ kind: 'created', scope: creationScope, parent: source,
        row: { thread, contact, latest: null, unread: 0, hasAttachments: false } });
    },
  });
  const openCategoryDialog = (intent: CategoryDialogIntent) => {
    if (dialog || covered || creation.current || activeCategorySurface.current !== categorySurface || runningCategoryAction.current?.scope === categoryScope) return;
    if (!notificationMessageId) cancelPendingOpen();
    setCategoryFeedback(null);
    setCategoryDialog({ surface: categorySurface, intent, parent });
  };
  const closeCategoryDialog = useCallback(() => {
    if (runningCategoryAction.current?.scope === categoryScope) return;
    setCategoryDialog(null);
    setCategoryFeedback(null);
  }, [categoryScope]);
  useLayoutEffect(() => {
    if (!dialog) return;
    const context: NavigationContext = { ...dialog.parent, title: categoryDialogTitle(dialog.intent), level: 2, onBack: () => {
      if (activeCategorySurface.current !== dialog.surface) return;
      if (runningCategoryAction.current?.scope === categoryScope) {
        // Browser Back can consume the nested history entry during a write.
        onNavigationContextChange({ ...context });
      } else closeCategoryDialog();
    } };
    onNavigationContextChange(context);
    // The enclosing coach workspace owns its parent context. A root surface's
    // title-only snapshot must not become a new nested history entry.
    return () => onNavigationContextChange(!relationshipId && dialog.parent?.level === 1 ? dialog.parent : null);
  }, [dialog, categoryScope, closeCategoryDialog, onNavigationContextChange, relationshipId]);

  const runCategoryAction = async <T,>(operation: () => Promise<T>, fallback: string, onSuccess?: (result: T) => void) => {
    if (covered || activeCategorySurface.current !== categorySurface || runningCategoryAction.current?.scope === categoryScope) return;
    const action = { scope: categoryScope };
    runningCategoryAction.current = action;
    setCategoryFeedback({ scope: categoryScope, surface: categorySurface, pending: true, error: '' });
    try {
      const result = await operation();
      if (activeCategorySurface.current === categorySurface) {
        setCategoryFeedback(null);
        onSuccess?.(result);
      }
    } catch (reason) {
      if (activeCategorySurface.current === categorySurface) {
        setCategoryFeedback({ scope: categoryScope, surface: categorySurface, pending: false, error: categoryMutationError(reason, fallback) });
      }
    } finally {
      if (runningCategoryAction.current === action) {
        runningCategoryAction.current = null;
        if (activeCategorySurface.current) {
          setCategoryFeedback(current => current?.surface === categorySurface && current.pending ? null : current);
        }
      }
    }
  };
  const submitCategoryDialog = (name: string) => {
    if (!dialog) return;
    const { intent } = dialog;
    if (intent.kind === 'delete-chat') {
      if (!db || !actorId) return;
      void runCategoryAction(() => new DiscussionRepository(db, actorId, intent.thread).deleteFreeDiscussion(intent.thread.id),
        'Не удалось удалить чат. Повторите попытку.', () => setCategoryDialog(null));
      return;
    }
    const organizationRepository = organization.repository;
    if (!organizationRepository) {
      setCategoryFeedback({ scope: categoryScope, surface: categorySurface, pending: false, error: 'Категории обсуждений недоступны.' });
      return;
    }
    if (intent.kind === 'create') {
      void runCategoryAction(() => organizationRepository.createCategory(name), 'Не удалось создать категорию.', category => {
        // Read back from the committed local transaction even if the previous
        // subscription has not delivered its invalidation yet.
        organization.retry();
        selectCategory(categoryTabValue({ kind: 'custom', id: category.id }));
        setCategoryDialog(null);
      });
    } else if (intent.kind === 'rename') {
      void runCategoryAction(() => organizationRepository.renameCategory(intent.category.id, name),
        'Не удалось переименовать категорию.', () => setCategoryDialog(null));
    } else {
      void runCategoryAction(() => organizationRepository.removeCategory(intent.category.id), 'Не удалось удалить категорию.', () => {
        selectCategory('all');
        setCategoryDialog(null);
      });
    }
  };
  const moveThread = (row: DiscussionInboxRow, category: AssignableDiscussionCategory | null) => {
    const organizationRepository = organization.repository;
    if (!organizationRepository || !organization.snapshot || dialog || creation.current) return;
    void runCategoryAction(() => category === null
      ? organizationRepository.clearThreadAssignment(row.thread)
      : organizationRepository.assignThread(row.thread, category), 'Не удалось переместить обсуждение. Повторите попытку.');
  };
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
        },
        () => {
          if (cancelled || generation !== request.current) return;
          ++request.current;
          subscription?.unsubscribe();
          window.clearTimeout(pendingTimer);
          setOpenError('Обсуждение недоступно.');
          onNotificationOpened?.();
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
  const closeLinkedChat = current?.row.thread.anchor.kind === 'free' ? close : closeNotificationChat;
  const chatParent = useMemo<NavigationContext | null>(() => {
    if (!current) return null;
    const displayName = (createdContact ?? current.row.contact)?.displayName ?? 'Вы';
    return { ...current.parent, level: 2, title: current.row.thread.derivedTitleSnapshot,
      ...(current.kind === 'chat' ? {
        avatarTransitionKey: current.flightKey ?? discussionAvatarFlightKey(current.row.thread.realmId, current.row.thread.anchorKey),
        identity: { title: displayName, avatar: { name: displayName, src: current.avatarSrc } },
      } : current.kind === 'created' ? { identity: { title: displayName, avatar: { name: displayName } } } : {}),
      onBack: current.kind === 'notification' ? closeLinkedChat : close };
  }, [current, createdContact?.displayName, close, closeLinkedChat]);
  const chatNavigation = useCallback((value: NavigationContext | null) => {
    onNavigationContextChange(openRef.current ? value : null);
  }, [onNavigationContextChange]);
  useEffect(() => {
    if (!picker) return;
    onNavigationContextChange({ ...picker.parent, title: 'Период обсуждений', level: 2, onBack: closePicker });
    return () => onNavigationContextChange(!relationshipId && picker.parent?.level === 1 ? picker.parent : null);
  }, [picker, closePicker, onNavigationContextChange, relationshipId]);
  useEffect(() => {
    if (!clientFilter) return;
    onNavigationContextChange({ ...clientFilter.parent, title: 'Фильтр по клиентам', level: 2, onBack: closeClientFilter });
    return () => onNavigationContextChange(clientFilter.parent?.level === 1 ? clientFilter.parent : null);
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
    const origin = capturedOrigin.current;
    cancelPendingOpen();
    const generation = request.current;
    setOpenError('');
    try {
      // Entity entry points use the same idempotent operation. Historical headers
      // stay intact; the canonical sheet projects them as one conversation.
      const repository = new DiscussionRepository(cloud.db, cloud.actorUserId, row.thread);
      const thread = row.thread.anchor.kind === 'free'
        ? await repository.getThread(row.thread.id)
        : await repository.ensureEntityThread(row.thread.anchor, row.thread.derivedTitleSnapshot);
      if (generation === request.current) {
        if (origin?.key === discussionAvatarFlightKey(row.thread.realmId, row.thread.anchorKey)) avatarFlight.begin(origin);
        setOpened({ row: { ...row, thread }, kind: 'chat', parent, avatarSrc: origin?.avatar.src, flightKey: origin?.key });
      }
    } catch {
      if (generation === request.current) setOpenError('Не удалось открыть обсуждение. Повторите нажатие.');
    }
  };
  const classifications = useMemo(() => organization.snapshot
    ? new Map(organization.snapshot.threads.map(item => [item.thread.id, categoryTabValue(item.category)]))
    : null, [organization.snapshot]);
  const validTabs = new Set([...tabs.map(tab => tab.value), 'uncategorized']);
  const invalidProjection = Boolean(classifications && inbox.rows.some(row => {
    const value = classifications.get(row.thread.id);
    return !value || !validTabs.has(value);
  }));
  const organizationError = organization.failed || invalidProjection;
  const organizationDiagnostics = new Set<number>();
  if (organization.failed) organizationDiagnostics.add(discussionOrganizationCode('OBSERVATION_FAILED'));
  if (invalidProjection) organizationDiagnostics.add(discussionOrganizationCode('PROJECTION_INVALID'));
  for (const code of organization.snapshot?.diagnostics ?? []) organizationDiagnostics.add(discussionOrganizationCode(code));
  for (const item of organization.snapshot?.threads ?? []) {
    for (const code of item.diagnostics) organizationDiagnostics.add(discussionOrganizationCode(code));
  }
  const rows = inbox.rows.filter(row => {
    if (activeTab !== 'all' && (organization.loading || organizationError || classifications?.get(row.thread.id) !== activeTab)) return false;
    if (relationshipId && row.thread.coachClientId !== relationshipId) return false;
    if (!relationshipId && clientUserIds.length && !cloud?.clients.some(contact =>
      contact.relationshipId === row.thread.coachClientId && clientUserIds.includes(contact.userId))) return false;
    if (!from && !to) return true;
    if (!row.latest) return false;
    const date = discussionLocalDate(row.latest.createdAt);
    return (!from || date >= from) && (!to || date <= to);
  });
  const emptyLabel = activeTab === 'coach' ? 'Здесь чаты, которые тренер вынес в отдельную категорию.'
    : activeTab === 'client' ? 'Здесь чаты, которые клиенты вынесли в отдельную категорию.'
      : from || to || clientUserIds.length ? 'За выбранный период обсуждений нет' : 'Обсуждений пока нет';
  const notificationChat = current?.kind === 'notification' && !closedNotificationChat && repository
    ? createPortal(<div className="navigation-overlay-root k-ios dark safe-areas">
      <DiscussionSheet opened repository={repository} threadId={current.row.thread.id} anchor={current.row.thread.anchor}
        focusMessageId={current.messageId} onClose={closeLinkedChat} onBack={closeLinkedChat}
        contextLabel={current.row.thread.derivedTitleSnapshot}
        parentNavigation={chatParent} onNavigationContextChange={setNotificationChatContext}
        resolveAuthor={id => ({ name: id === actorId ? 'Вы' : (notificationContact || activeRow?.contact)?.displayName ?? 'Участник обсуждения' })} />
    </div>, document.body) : null;
  if (current?.kind === 'notification' && current.row.thread.anchor.kind !== 'free') return <>
    <DiscussionEntity thread={current.row.thread} role={role}
      onBack={close} onNavigationContextChange={setNotificationEntityContext} />
    {notificationChat}
  </>;
  if (current?.kind === 'entity' && current.row.thread.anchor.kind !== 'free') return <DiscussionEntity thread={current.row.thread} role={role}
    onBack={close} onNavigationContextChange={onNavigationContextChange} />;
  return <section className="discussion-inbox" aria-label="Обсуждения">
    {creation.action && (relationshipId ? <DiscussionWorkspaceFab action={creation.action} />
      : <DiscussionsDestinationFab action={creation.action} />)}
    <div className="discussion-inbox__toolbar">
      <div className="discussion-inbox__tabs">
        <LiquidGlassTextOnly tabs={tabs} value={activeTab} onValueChange={value => {
          if (!notificationMessageId) cancelPendingOpen();
          selectCategory(value);
        }} hidden={false} fullWidth />
      </div>
      <DiscussionCategoryMenu key={activeTab} category={manageCategory} scope={categorySurface}
        disabled={Boolean(categoryBusy || covered || dialog || creation.current)}
        available={Boolean(organization.repository && organization.snapshot && !organization.loading && !organization.failed)}
        onEdit={openCategoryDialog} />
    </div>
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
    {cloud ? <Text variant="caption" role="status">{syncStatusLabel(cloud.syncStatus)}</Text> : null}
    {notificationMessageId && !opened && !openError ? <Text variant="footnote" role="status">Загружаем обсуждение по ссылке…</Text> : null}
    {openError ? <div className="stack"><Text role="alert">{openError}</Text>
      {notificationMessageId && !opened ? <Button rounded tonal onClick={retryNotification}><Text>Повторить</Text></Button> : null}
    </div> : null}
    {unavailableCreatedChat === creationScope && !covered && !notificationMessageId
      ? <Text role="alert" variant="footnote">Чат создан и назначен в категорию. Собеседник больше недоступен.</Text> : null}
    {inbox.error ? <div className="stack"><Text role="alert">{inbox.error}</Text>
      <Button rounded tonal onClick={() => { cancelPendingOpen(); inbox.retry(); }}><Text>Повторить</Text></Button></div> : null}
    {feedback?.error && !dialog ? <Text variant="footnote" role="alert">{feedback.error}</Text> : null}
    {cloud?.status === 'error' && !rows.length ? <Text role="status">{cloud.error}</Text> : null}
    {inbox.loading && !rows.length ? <Text>Загружаем обсуждения…</Text>
      : organization.loading ? <Text>Загружаем категории обсуждений…</Text>
        : cloud?.status === 'ready' && !inbox.error && !organizationError && !rows.length ? <Text>{emptyLabel}</Text> : null}
    <DiscussionInboxList rows={rows.slice(0, limit)} onOpen={row => { void openChat(row); }}
      onOpenOrigin={(_row, origin) => { capturedOrigin.current = origin; }}
      onAvatarSourceChange={syncOpenedAvatarSource}
      hiddenAvatarKey={current?.kind === 'chat' ? discussionAvatarFlightKey(current.row.thread.realmId, current.row.thread.anchorKey) : undefined}
      moveActions={organization.snapshot && !organizationError
        ? { categories: organization.categories, disabled: categoryBusy || Boolean(creation.current), move: moveThread,
          remove: row => openCategoryDialog({ kind: 'delete-chat', thread: row.thread }) } : undefined}
      onEntity={row => { cancelPendingOpen(); setOpened({ row, kind: 'entity', parent }); }} />
    {rows.length > limit ? <Button rounded tonal onClick={() => { cancelPendingOpen(); setLimit(value => value + 50); }}><Text>Показать ещё</Text></Button> : null}
    {organizationDiagnostics.size > 0 ? <div className="stack" role="status">
      {[...organizationDiagnostics].sort((a, b) => a - b).map(code => <Text key={code} variant="footnote">Код {code}</Text>)}
      {organizationError && <Button rounded tonal onClick={organization.retry}><Text>Повторить загрузку категорий</Text></Button>}
    </div> : null}
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
    {dialog && createPortal(<div className="navigation-overlay-root k-ios dark safe-areas">
      <DiscussionCategoryDialog intent={dialog.intent} pending={categoryBusy} error={feedback?.error ?? ''}
        onClearError={() => setCategoryFeedback(null)} onSubmit={submitCategoryDialog} onClose={closeCategoryDialog} />
    </div>, document.body)}
    {createPortal(<div className="navigation-overlay-root k-ios dark safe-areas">
      <DiscussionContactPicker opened={creation.current?.step === 'contact'} role={role} contacts={creation.contacts}
        status={cloud?.status ?? 'error'} onSelect={creation.select} onClose={creation.close} />
      {creation.current?.step === 'title' ? <FreeDiscussionTitleDialog pending={creation.current.pending}
        saved={Boolean(creation.current.saved)} error={creation.current.error} onClearError={creation.clearError}
        onSubmit={title => { void creation.submit(title); }} onClose={creation.close} /> : null}
    </div>, document.body)}
    {notificationChat}
    {(current?.kind === 'chat' || current?.kind === 'created') && currentThread && repository && createPortal(<div className="navigation-overlay-root k-ios dark safe-areas">
      <DiscussionSheet opened repository={repository} threadId={currentThread.id} anchor={currentThread.anchor}
        onClose={close} onBack={close} contextLabel={currentThread.derivedTitleSnapshot}
        parentNavigation={chatParent} onNavigationContextChange={chatNavigation}
        resolveAuthor={id => ({ name: id === actorId ? 'Вы' : (createdContact ?? activeRow?.contact)?.displayName ?? 'Участник обсуждения' })} />
    </div>, document.body)}
  </section>;
}
