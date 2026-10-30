import { useEffect, useRef, useState } from 'react';
import { getMe } from '../api';
import { createCloudDatabase, type MezfitCloudDatabase } from '../data/cloud/database';
import { FlexAttributesRepository, type FlexEntityTarget } from '../data/cloud/flex-attributes';
import { Button, Text } from '../ui';

/** One opt-in, reusable technical marker; no workout or profile settings are changed. */
export const FLEX_PROBE_KEY = 'MezfitFlexDiagnosticV1';

type Stage = 'identity' | 'opening' | 'ready' | 'failed';
type Operation = 'idle' | 'writing' | 'reading' | 'written' | 'read' | 'not-found' | 'failed';

interface DiagnosticSession {
  db: MezfitCloudDatabase;
  actorUserId: string;
  repo: FlexAttributesRepository<MezfitCloudDatabase>;
}

function personalTarget(actorUserId: string): FlexEntityTarget {
  return { entityType: 'user', entityId: actorUserId, realmId: actorUserId };
}

/**
 * Manual real-account smoke test for the Addon path. Neither an admin REST
 * write nor a simulated authorization test. The marker stays in the user's
 * own cloud realm so another device can read it after an ordinary sync.
 */
export function FlexAttributesDiagnostic({ initData }: { initData: string }) {
  const [stage, setStage] = useState<Stage>('identity');
  const [identityConfirmed, setIdentityConfirmed] = useState(false);
  const [operation, setOperation] = useState<Operation>('idle');
  const [marker, setMarker] = useState<string | null>(null);
  const sessionRef = useRef<DiagnosticSession | null>(null);
  const activeRef = useRef(false);
  const pendingRef = useRef(false);

  useEffect(() => {
    activeRef.current = true;
    let active = true;
    let db: MezfitCloudDatabase | undefined;
    let userSubscription: { unsubscribe(): void } | undefined;
    setStage('identity');
    setIdentityConfirmed(false);
    setOperation('idle');
    setMarker(null);

    void (async () => {
      try {
        // Server-verified identity: never use initDataUnsafe or a caller-provided user ID.
        const me = await getMe(initData);
        if (!active) return;
        const telegramId: unknown = me?.user?.telegramUserId;
        if (typeof telegramId !== 'string' || !/^[1-9]\d*$/.test(telegramId)) {
          throw new Error('INVALID_AUTHENTICATED_ACCOUNT');
        }
        const actorUserId = 'tg:' + telegramId;
        db = createCloudDatabase(telegramId, initData);
        const cloudDb = db;
        userSubscription = cloudDb.cloud.currentUser.subscribe({
          next: (user) => { if (active) setIdentityConfirmed(user.userId === actorUserId); },
          error: () => { if (active) setIdentityConfirmed(false); },
        });
        setStage('opening');
        await cloudDb.open();
        if (!active) return;
        sessionRef.current = {
          db: cloudDb,
          actorUserId,
          repo: new FlexAttributesRepository(cloudDb, actorUserId),
        };
        setStage('ready');
      } catch {
        if (active) setStage('failed');
      }
    })();

    return () => {
      active = false;
      activeRef.current = false;
      sessionRef.current = null;
      userSubscription?.unsubscribe();
      db?.close({ disableAutoOpen: false });
    };
  }, [initData]);

  const run = async (action: 'write' | 'read') => {
    const session = sessionRef.current;
    if (!session || !identityConfirmed || pendingRef.current) return;
    pendingRef.current = true;
    setMarker(null);
    setOperation(action === 'write' ? 'writing' : 'reading');
    try {
      const target = personalTarget(session.actorUserId);
      if (action === 'write') {
        const nextMarker = new Date().toISOString();
        await session.repo.setValue(target, {
          key: FLEX_PROBE_KEY,
          valueType: 'string',
          value: nextMarker,
        });
        // Check the local commit before claiming that an upload was attempted.
        const local = await session.repo.getValues(target);
        if (!local.some((entry) => entry.key === FLEX_PROBE_KEY
          && entry.valueType === 'string' && entry.value === nextMarker)) {
          throw new Error('FLEX_LOCAL_WRITE_MISSING');
        }
        // Addon 4.4.15 waits until the pending mutation queue is drained.
        await session.db.cloud.sync({ purpose: 'push', wait: true });
        if (activeRef.current && sessionRef.current === session) {
          setMarker(nextMarker);
          setOperation('written');
        }
      } else {
        await session.db.cloud.sync({ purpose: 'pull', wait: true });
        const values = await session.repo.getValues(target);
        const recorded = values.find((entry) => entry.key === FLEX_PROBE_KEY);
        if (activeRef.current && sessionRef.current === session) {
          const validMarker = recorded?.valueType === 'string' && typeof recorded.value === 'string'
            ? recorded.value : null;
          setMarker(validMarker);
          setOperation(validMarker === null ? 'not-found' : 'read');
        }
      }
    } catch {
      // No raw Cloud/Worker errors or credentials are exposed by the diagnostic.
      if (activeRef.current && sessionRef.current === session) setOperation('failed');
    } finally {
      pendingRef.current = false;
    }
  };

  const ready = stage === 'ready' && identityConfirmed;
  const busy = operation === 'writing' || operation === 'reading';

  return (
    <section aria-label="Проверка Flex Attributes">
      <Text variant="headline" role="heading" aria-level={2}>Flex Attributes — проверка реальной записи</Text>
      <p><Text variant="body">
        Проверка выполняется под вашим аккаунтом Telegram через Dexie Cloud Addon.
        Записывается только техническая строка в личный realm; тренировки и права не изменяются.
      </Text></p>
      <p><Text variant="body">Подтверждённый облачный пользователь: {identityConfirmed ? 'да' : 'нет'}</Text></p>
      {stage === 'failed'
        ? <p role="alert"><Text variant="body">Не удалось открыть облачную базу для проверки.</Text></p>
        : null}
      <Button variant="primary" disabled={!ready || busy}
        onClick={() => { void run('write'); }}>
        {operation === 'writing' ? 'Сохраняем…' : 'Записать тестовое значение'}
      </Button>
      <Button variant="secondary" disabled={!ready || busy}
        onClick={() => { void run('read'); }}>
        {operation === 'reading' ? 'Читаем…' : 'Загрузить из облака и прочитать'}
      </Button>
      <p role="status" aria-live="polite"><Text variant="body">
        {stage === 'identity' || stage === 'opening'
          ? 'Подключаем Dexie Cloud…'
          : !identityConfirmed
            ? 'Ожидаем подтверждения облачной личности.'
            : operation === 'written'
              ? 'Локальная запись проверена; отправка через Addon завершилась.'
              : operation === 'read'
                ? 'Синхронизация чтения завершилась.'
                : operation === 'not-found'
                  ? 'Тестовая запись пока не найдена в доступных данных.'
                  : operation === 'failed'
                    ? 'Проверка не удалась. Данные о причине не отображаются.'
                    : operation === 'writing' || operation === 'reading'
                      ? 'Выполняем запрос к Dexie Cloud…'
                      : 'Выберите действие для проверки.'}
      </Text></p>
      {marker ? <p><Text variant="body">Контрольное значение: {marker}</Text></p> : null}
      <p><Text variant="footnote" tone="muted">
        Сравните контрольное значение на втором устройстве того же пользователя через кнопку чтения.
        Завершение отправки на одном устройстве не доказывает межустройственную синхронизацию.
      </Text></p>
      <p><Text variant="footnote" tone="muted">
        Техническая запись с ключом {FLEX_PROBE_KEY} остаётся в вашем личном облачном хранилище.
        Данная проверка не подтверждает права Coach/Client в общих realm и отказы для чужих realm.
      </Text></p>
    </section>
  );
}
