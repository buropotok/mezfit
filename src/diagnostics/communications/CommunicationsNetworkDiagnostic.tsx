import { useEffect, useRef, useState } from 'react';
import { Button } from 'konsta/react';
import { Text } from '../../ui';
import { getTelegramWebApp } from '../../telegram';
import { HARNESS_VERSION, probeHosting, type ProbeResult } from './networkProbe';
import { DirectMediaDiagnostic } from './DirectMediaDiagnostic';

/** Explicit experiment surface inside the existing Telegram-only diagnostic entry. */
export function CommunicationsNetworkDiagnostic() {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('Запустите проверку после отключения VPN.');
  const [results, setResults] = useState<ProbeResult[]>([]);
  const [copied, setCopied] = useState(false);
  const active = useRef<AbortController | null>(null);
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; active.current?.abort(); };
  }, []);

  const run = async (action: (signal: AbortSignal) => Promise<ProbeResult[]>) => {
    if (active.current) return;
    const controller = new AbortController();
    active.current = controller; setBusy(true); setCopied(false);
    try {
      const next = await action(controller.signal);
      if (mounted.current) setResults(previous => [...previous, ...next].slice(-30));
    } catch {
      if (mounted.current) setNote(controller.signal.aborted ? 'Проверка остановлена.' : 'Проверка не завершена. Проверьте файл, его длительность и доступность сети.');
    } finally {
      if (active.current === controller) active.current = null;
      if (mounted.current) setBusy(false);
    }
  };

  const copyReport = async () => {
    const platform = getTelegramWebApp()?.platform;
    // Explicit allowlist: no File.name, initData, user IDs, request/error body or signed URLs.
    const report = { harness: HARNESS_VERSION, capturedAt: new Date().toISOString(), origin: location.origin,
      platform: platform === 'ios' || platform === 'android' ? platform : 'other',
      vpn: 'owner-must-record', coldStart: 'not-proven-by-this-panel',
      tokenRefresh: 'record-separately-with-addon', results, backgroundConclusion: 'requires-server-and-owner-observation' };
    try { await navigator.clipboard.writeText(JSON.stringify(report, null, 2)); if (mounted.current) setCopied(true); }
    catch { if (mounted.current) setNote('Копирование недоступно. Сделайте снимок только таблицы результатов.'); }
  };

  return <section aria-label="COMM-02: проверка сети без VPN">
    <Text variant="headline" role="heading" aria-level={2}>Проверка сети без VPN</Text>
    <p><Text variant="footnote">Версия диагностики: {HARNESS_VERSION}</Text></p>
    <p><Text variant="body">Сначала откройте приложение, затем выключите VPN. Холодный старт и обновление токенов проверяются отдельно по инструкции.</Text></p>
    <Button rounded disabled={busy} onClick={() => void run(signal => probeHosting(location.origin, signal))}>Проверить HTML и JS по сети</Button>
    <Button rounded disabled={!busy} onClick={() => active.current?.abort()}>Остановить проверку</Button>
    <p role="status"><Text variant="body">{busy ? 'Идёт проверка.' : note}</Text></p>
    {results.map((result, index) => <p key={index}><Text variant="footnote">{result.step}: {result.code}; HTTP {result.status ?? '—'}; {result.elapsedMs} мс</Text></p>)}
    <Button rounded disabled={busy || !results.length} onClick={() => void copyReport()}>{copied ? 'Отчёт скопирован' : 'Скопировать безопасный отчёт'}</Button>
    <DirectMediaDiagnostic />
  </section>;
}
