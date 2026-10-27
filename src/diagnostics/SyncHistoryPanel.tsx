import { useEffect, useSyncExternalStore } from 'react';
import { useCloudConnections } from '../data/cloud/CloudConnectionsProvider';
import { type SyncHistoryEvent, SYNC_HISTORY_LIMIT, SYNC_HISTORY_WINDOW_MS } from '../data/cloud/session-sync-history';
import { Button, GlassSurface, Text } from '../ui';
import '../settings/settings-page.css';

const emptyEvents: readonly SyncHistoryEvent[] = [];
const noSubscribe = (): (() => void) => () => {};
const getEmpty = (): readonly SyncHistoryEvent[] => emptyEvents;

function describeEvent(event: SyncHistoryEvent): string {
  return event.source === 'sync'
    ? `Sync: ${event.phase} / ${event.status}`
    : `WebSocket: ${event.status}`;
}

/** A technical-only timeline; the provider records events even while Settings is closed. */
export function SyncHistoryPanel({ glassBlur }: { glassBlur?: number }) {
  const history = useCloudConnections()?.syncHistory;
  const events = useSyncExternalStore(
    history?.subscribe ?? noSubscribe,
    history?.getSnapshot ?? getEmpty,
  );

  useEffect(() => {
    if (!history) return;
    history.prune();
    const timer = window.setInterval(() => history.prune(), 60_000);
    return () => window.clearInterval(timer);
  }, [history]);

  return <section className="settings-page" aria-label="История синхронизации">
    <GlassSurface component="section" wrapContent={false} preset="modalTuned"
      optics={false} blur={glassBlur} shape={{ radius: 16 }} className="settings-page__section">
      <Text variant="title">История Dexie Cloud</Text>
      <Text variant="footnote" tone="muted">
        Переходы Sync и WebSocket за последние {SYNC_HISTORY_WINDOW_MS / 60_000} минут.
        Только текущая сессия браузера, до {SYNC_HISTORY_LIMIT} событий.
        Не отправляется в облако.
      </Text>
      <Text variant="footnote" tone="muted">
        Это состояния соединения, а не подтверждения доставки конкретной тренировки.
      </Text>
      {events.length ? (
        <>
          <div className="settings-page__sync-history-list" role="list" aria-label="События Dexie Cloud">
            {[...events].reverse().map((event, index) => (
              <div role="listitem" className="settings-page__sync-history-item"
                key={`${event.at}-${event.source}-${index}`}>
                <Text variant="caption" tone="muted">
                  {new Date(event.at).toLocaleTimeString('ru-RU', {
                    hour: '2-digit', minute: '2-digit', second: '2-digit',
                  })}
                </Text>
                <Text variant="body">{describeEvent(event)}</Text>
              </div>
            ))}
          </div>
          <span className="settings-page__action">
            <Button variant="secondary" onClick={() => history?.clear()}>Очистить историю</Button>
          </span>
        </>
      ) : (
        <Text variant="body">Событий за последний час нет.</Text>
      )}
      {!history ? <Text variant="footnote" tone="muted">Облачная база не подключена.</Text> : null}
    </GlassSurface>
  </section>;
}
