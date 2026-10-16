import { useEffect, useState } from 'react';
import { liveQuery } from 'dexie';
import { getMe } from '../api';
import { createCloudDatabase, type MezfitCloudDatabase } from '../data/cloud/database';
import { deriveCloudContacts } from '../data/cloud/CloudConnectionsProvider';
import { Text } from '../ui';
import { cloudSyncErrorCode } from './cloudSyncErrorCode';
import { globalCoachPhasePermission } from './cloudPhasePermissions';

interface Snapshot {
  phase: string;
  status: string;
  stage: 'identity' | 'opening' | 'observing' | 'failed';
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
}

const initial: Snapshot = {
  phase: 'initial',
  status: 'not-started',
  stage: 'identity',
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

        update({ stage: 'opening' });
        await cloudDb.open();
        if (!active) return;

        const localSubscription = liveQuery(async () => {
          const [realms, members, roles] = await Promise.all([
            cloudDb.realms.toArray(),
            cloudDb.members.toArray(),
            cloudDb.table<unknown>('roles').toArray(),
          ]);
          let clients: number | null = null;
          let coaches: number | null = null;
          let readError = false;
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
          };
        }).subscribe({
          next: (counts) => update(counts),
          error: () => update({ readError: true }),
        });
        subscriptions.push(localSubscription);

        update({ stage: 'observing' });
        // Trigger a pull without waiting indefinitely for its completion.
        // Official sync state and synced local tables are observed separately.
        await cloudDb.cloud.sync({ purpose: 'pull', wait: false });
      } catch {
        update({ stage: 'failed', setupError: true });
      }
    })();

    return () => {
      active = false;
      subscriptions.forEach((subscription) => subscription.unsubscribe());
      db?.close({ disableAutoOpen: false });
    };
  }, [initData]);

  return (
    <section aria-label="Диагностика синхронизации Dexie Cloud">
      <Text variant="headline" role="heading" aria-level={2}>Синхронизация и локальная база</Text>
      <p><Text variant="body">Этап: {snapshot.stage}</Text></p>
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
      {snapshot.setupError || snapshot.readError
        ? <p role="alert"><Text variant="body">Диагностика обнаружила ошибку открытия или чтения локальной базы.</Text></p>
        : null}
      <p><Text variant="footnote" tone="muted">Показаны только состояния, количества и безопасный код ошибки. Полный текст ошибки, токены, Telegram ID и содержимое записей не выводятся.</Text></p>
    </section>
  );
}
