import { useEffect, useRef, useState } from 'react';
import { Button, Text } from '../ui';
import { runBrowserCloudAuthProbe } from './cloudAuthProbe';

export function BrowserDexieDiagnostic({ telegramUserId, disabled }: { telegramUserId: string; disabled: boolean }) {
  const request = useRef<AbortController | null>(null);
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState('');

  useEffect(() => () => {
    request.current?.abort();
    request.current = null;
  }, []);

  async function check() {
    if (request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setPending(true);
    setResult('');
    const timeout = window.setTimeout(() => controller.abort(), 15_000);

    try {
      const { status, subjectMatches } = await runBrowserCloudAuthProbe(telegramUserId, controller.signal);
      if (request.current !== controller) return;
      if (controller.signal.aborted) {
        setResult('Время ожидания истекло');
        return;
      }
      const detail = status !== 200
        ? 'Сервер не выдал токен'
        : subjectMatches === null
          ? 'Некорректный ответ Dexie'
          : subjectMatches ? 'ID совпадает: да' : 'ID совпадает: нет';
      setResult(`HTTP ${status} · ${detail}`);
    } catch {
      if (request.current === controller) {
        setResult(controller.signal.aborted ? 'Время ожидания истекло' : 'Не удалось выполнить проверку Dexie');
      }
    } finally {
      window.clearTimeout(timeout);
      if (request.current === controller) {
        request.current = null;
        setPending(false);
      }
    }
  }

  return (
    <>
      <Button variant="secondary" onClick={() => void check()} disabled={disabled || pending}>Проверить Dexie</Button>
      {(pending || result) && <Text variant="footnote" role="status">{pending ? 'Проверяем выдачу токена…' : result}</Text>}
    </>
  );
}
