import { useEffect, useState } from 'react';
import { liveQuery } from 'dexie';
import { getMe } from '../api';
import { createCloudDatabase, type MezfitCloudDatabase } from '../data/cloud/database';
import { deriveCloudContacts } from '../data/cloud/CloudConnectionsProvider';
import { Text } from '../ui';
import { cloudSyncErrorCode } from './cloudSyncErrorCode';
import { globalCoachPhasePermission } from './cloudPhasePermissions';
import { readDiscussionDiagnostics, type DiscussionReadDiagnosticReport } from '../data/cloud/discussion-read-diagnostics';
import { DiscussionReadDiagnostic } from './DiscussionReadDiagnostic';

type LocalOpenState = 'not-started' | 'waiting' | 'blocked' | 'ready' | 'opened' | 'failed';

const LOCAL_OPEN_WARNING_MS = 12_000;

/** Only a bounded error category is displayed; IndexedDB error messages may expose private data. */
function localOpenErrorCode(reason: unknown): string {
  const name = reason && typeof reason === 'object' && 'name' in reason
    ? (reason as { name?: unknown }).name : null;
  switch (name) {
    case 'VersionError': return 'VERSION_ERROR';
    case 'UpgradeError': return 'UPGRADE_ERROR';
    case 'SchemaError': return 'SCHEMA_ERROR';
    case 'DatabaseClosedError': return 'DATABASE_CLOSED';
    case 'OpenFailedError': return 'OPEN_FAILED';
    case 'InvalidStateError': return 'INVALID_STATE';
    case 'AbortError': return 'ABORT_ERROR';
    case 'QuotaExceededError': return 'QUOTA_EXCEEDED';
    case 'SecurityError': return 'SECURITY_ERROR';
    case 'UnknownError': return 'UNKNOWN_ERROR';
    default: return 'OTHER_OPEN_ERROR';
  }
}

interface Snapshot {
  phase: string;
  status: string;
  stage: 'identity' | 'opening' | 'observing' | 'failed';
  localOpen: LocalOpenState;
  localOpenSlow: boolean;
  localOpenError: string | null;
  persisted: boolean;
  persistedError: boolean;
  syncErrorCode: string | null;
  persistedErrorCode: string | null;
  sameCloudAccount: boolean;
  realms: number | null;
  members: number | null;
  ownMembers: number | null;
  coaches: number | null;
  clients: number | null;
  readError: boolean;
  setupError: boolean;
  coachPhasePermission: boolean | null;
  discussionReads: DiscussionReadDiagnosticReport | null;
  discussionReadError: boolean;
}

const initial: Snapshot = {
  phase: 'initial',
  status: 'not-started',
  stage: 'identity',
  localOpen: 'not-started',
  localOpenSlow: false,
  localOpenError: null,
  persisted: false,
  persistedError: false,
  syncErrorCode: null,
  persistedErrorCode: null,
  sameCloudAccount: false,
  realms: null,
  members: null,
  ownMembers: null,
  coaches: null,
  clients: null,
  readError: false,
  setupError: false,
  coachPhasePermission: null,
  discussionReads: null,
  discussionReadError: false,
};

function textCount(count: number | null): string {
  return count === null ? 'ещё не прочитано' : String(count);
}

/** Read-only Telegram-device diagnostic. No tokens, IDs, rows or error bodies are shown. */
export function CloudSyncDiagnostic({ initData }: { initData: string }) {
  const [snapshot, setSnapshot] = useState<Snapshot>(initial);

  useEffect(() => {
    let active = true;
    let db: MezfitCloudDatabase | undefined;
    const subscriptions: Array<{ unsubscribe(): void }> = [];
    let openWarningTimer: ReturnType<typeof setTimeout> | null = null;
    let opening = false;
    let opened = false;

    const update = (patch: Partial<Snapshot>) => {
      if (active) setSnapshot((previous) => ({ ...previous, ...patch }));
    };

    void (async () => {
      try {
        // Use the Worker-verified Telegram account, not initDataUnsafe identity.
        const me = await getMe(initData);
        if (!active) return;
        const telegramUserId = me.user.telegramUserId;
        if (!/^[1-9][0-9]*$/.test(telegramUserId)) throw new Error('INVALID_AUTHENTICATED_ACCOUNT');
        const actorUserId = `tg:${telegramUserId}`;
        db = createCloudDatabase(telegramUserId, initData);
        const cloudDb = db;

        subscriptions.push(cloudDb.cloud.syncState.subscribe((state) => {
          update({ phase: state.phase, status: state.status, syncErrorCode: cloudSyncErrorCode(state.error) });
        }));
        subscriptions.push(cloudDb.cloud.persistedSyncState.subscribe((state) => {
          update({
            persisted: state?.timestamp != null,
            persistedError: Boolean(state?.error),
            persistedErrorCode: cloudSyncErrorCode(state?.error),
          });
        }));
        subscriptions.push(cloudDb.cloud.currentUser.subscribe((user) => {
          update({ sameCloudAccount: user.userId === actorUserId });
        }));

        // Database-open diagnostics must not await cloud sync. Dexie's blocked
        // event identifies a native IndexedDB upgrade held by another connection.
        cloudDb.on?.('blocked', () => update({ localOpen: 'blocked' }));
        cloudDb.on?.('ready', () => update({ localOpen: 'ready' }));
        opening = true;
        update({ stage: 'opening', localOpen: 'waiting' });
        openWarningTimer = setTimeout(() => update({ localOpenSlow: true }), LOCAL_OPEN_WARNING_MS);
        await cloudDb.open();
        opened = true;
        if (openWarningTimer !== null) clearTimeout(openWarningTimer);
        openWarningTimer = null;
        if (!active) return;
        update({ localOpen: 'opened' });

        const localSubscription = liveQuery(async () => {
          const [realms, members, roles] = await Promise.all([
            cloudDb.realms.toArray(),
            cloudDb.members.toArray(),
            cloudDb.table<unknown>('roles').toArray(),
          ]);
          let clients: number | null = null;
          let coaches: number | null = null;
          let readError = false;
          let discussionReads: DiscussionReadDiagnosticReport | null = null;
          let discussionReadError = false;
          try {
            discussionReads = await readDiscussionDiagnostics(cloudDb, actorUserId);
          } catch {
            discussionReadError = true;
          }
          try {
            const contacts = await deriveCloudContacts(actorUserId, realms, members);
            clients = contacts.clients.length;
            coaches = contacts.coaches.length;
          } catch {
            readError = true;
          }
          return {
            realms: realms.length,
            members: members.length,
            ownMembers: members.filter((member) => member.userId === actorUserId).length,
            clients,
            coaches,
            readError,
            coachPhasePermission: globalCoachPhasePermission(roles),
            discussionReads,
            discussionReadError,
          };
        }).subscribe({
          next: (counts) => update(counts),
          error: () => update({ readError: true, discussionReadError: true }),
        });
        subscriptions.push(localSubscription);

        update({ stage: 'observing' });
        // Trigger a pull without waiting indefinitely for its completion.
        // Official sync state and synced local tables are observed separately.
        await cloudDb.cloud.sync({ purpose: 'pull', wait: false });
      } catch (reason: unknown) {
        if (openWarningTimer !== null) clearTimeout(openWarningTimer);
        openWarningTimer = null;
        update({
          stage: 'failed', setupError: true,
          ...(opening && !opened ? { localOpen: 'failed' as const, localOpenError: localOpenErrorCode(reason) } : {}),
        });
      }
    })();

    return () => {
      active = false;
      if (openWarningTimer !== null) clearTimeout(openWarningTimer);
      subscriptions.forEach((subscription) => subscription.unsubscribe());
      db?.close({ disableAutoOpen: false });
    };
  }, [initData]);

  return (
    <section aria-label="Диагностика синхронизации Dexie Cloud">
      <Text variant="headline" role="heading" aria-level={2}>Синхронизация и локальная база</Text>
      <p><Text variant="body">Этап: {snapshot.stage}</Text></p>
      <p><Text variant="body">Открытие IndexedDB: {{
        'not-started': 'не начато',
        waiting: 'ожидание',
        blocked: 'заблокировано другим соединением',
        ready: 'событие ready получено',
        opened: 'открыта',
        failed: 'ошибка',
      }[snapshot.localOpen]}</Text></p>
      {snapshot.localOpenSlow ? <p role="status"><Text variant="body">
        Открытие занимает более 12 секунд; это ещё не подтверждает причину задержки.
      </Text></p> : null}
      {snapshot.localOpenError ? <p><Text variant="body">Код ошибки открытия: {snapshot.localOpenError}</Text></p> : null}
      <p><Text variant="body">Dexie: {snapshot.phase} / {snapshot.status}</Text></p>
      <p><Text variant="body">Облачный пользователь подтверждён: {snapshot.sameCloudAccount ? 'да' : 'нет'}</Text></p>
      <p><Text variant="body">Сохранённая синхронизация: {snapshot.persisted ? 'да' : 'нет'}</Text></p>
      <p><Text variant="body">Ошибка облачной синхронизации: {snapshot.persistedError || snapshot.status === 'error' ? 'да' : 'нет'}</Text></p>
      <p><Text variant="body">Код ошибки: {snapshot.syncErrorCode ?? snapshot.persistedErrorCode ?? 'не определён'}</Text></p>
      <p><Text variant="body">Локальные realms: {textCount(snapshot.realms)}</Text></p>
      <p><Text variant="body">Локальные members: {textCount(snapshot.members)}</Text></p>
      <p><Text variant="body">Мои membership: {textCount(snapshot.ownMembers)}</Text></p>
      <p><Text variant="body">Общая роль тренера разрешает programPhases: {snapshot.coachPhasePermission === null
        ? 'ещё не прочитано' : snapshot.coachPhasePermission ? 'да' : 'нет'}</Text></p>
      <p><Text variant="body">Подтверждённые связи: тренеры {textCount(snapshot.coaches)}, клиенты {textCount(snapshot.clients)}</Text></p>
      {snapshot.stage === 'observing'
        ? <DiscussionReadDiagnostic report={snapshot.discussionReads} failed={snapshot.discussionReadError} />
        : null}
      {snapshot.setupError || snapshot.readError
        ? <p role="alert"><Text variant="body">Диагностика обнаружила ошибку открытия или чтения локальной базы.</Text></p>
        : null}
      <p><Text variant="footnote" tone="muted">Показаны только состояния, количества и безопасный код ошибки. Полный текст ошибки, токены, Telegram ID и содержимое записей не выводятся.</Text></p>
    </section>
  );
}
