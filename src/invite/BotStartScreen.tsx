import { useEffect, useRef, useState } from 'react';
import { Button as KonstaButton } from 'konsta/react';
import { getMezfitChatActivation } from '../api';
import { openMezfitBotChat } from '../telegram';
import { Text } from '../ui';

/** Mandatory activation guidance; the parent Dexie provider remains mounted. */
export function BotStartScreen({ initData, onActivated }: {
  initData: string;
  onActivated: () => void;
}) {
  const [checkRevision, setCheckRevision] = useState(0);
  const [status, setStatus] = useState<'checking' | 'pending' | 'error'>('checking');
  const onActivatedRef = useRef(onActivated);
  useEffect(() => { onActivatedRef.current = onActivated; }, [onActivated]);

  useEffect(() => {
    let active = true;
    setStatus('checking');
    void getMezfitChatActivation(initData)
      .then(activated => {
        if (!active) return;
        if (activated) onActivatedRef.current();
        else setStatus('pending');
      })
      .catch(() => {
        if (active) setStatus('error');
      });
    return () => { active = false; };
  }, [initData, checkRevision]);

  useEffect(() => {
    let wasHidden = document.visibilityState === 'hidden';
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') wasHidden = true;
      else if (wasHidden) {
        wasHidden = false;
        setCheckRevision(value => value + 1);
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => { document.removeEventListener('visibilitychange', onVisibilityChange); };
  }, []);

  return (
    <main className="center">
      <section className="stack" style={{ width: 'min(420px, 100%)' }} aria-label="Активация Mezfit">
        <Text variant="footnote">Подключение к тренеру завершено</Text>
        <Text variant="title" role="heading" aria-level={1}>Активируйте Mezfit</Text>
        <Text variant="body">
          Чтобы получать сообщения от тренера и уведомления о тренировках, откройте чат Mezfit и нажмите «Старт».
        </Text>
        <KonstaButton rounded strong onClick={openMezfitBotChat}>Открыть чат Mezfit</KonstaButton>
        <Text variant="footnote">После нажатия «Старт» вернитесь в Mezfit.</Text>
        <KonstaButton rounded tonal disabled={status === 'checking'}
          onClick={() => setCheckRevision(value => value + 1)}>
          {status === 'checking' ? 'Проверяем активацию…' : 'Проверить активацию'}
        </KonstaButton>
        {status === 'pending' ? <Text variant="footnote" role="status">
          Активация пока не подтверждена. Откройте чат Mezfit и нажмите «Старт».
        </Text> : null}
        {status === 'error' ? <Text variant="footnote" role="alert">
          Не удалось проверить активацию. Проверьте соединение и повторите попытку.
        </Text> : null}
      </section>
    </main>
  );
}
