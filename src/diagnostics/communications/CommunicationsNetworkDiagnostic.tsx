import { useEffect, useRef, useState } from 'react';
import { Button } from 'konsta/react';
import { Text } from '../../ui';
import { getTelegramWebApp } from '../../telegram';
import { HARNESS_VERSION, parseStorageTicket, probeHosting, probeStorageReads, uploadProbe, videoDuration,
  type ProbeResult, type StorageTicket, type UploadEvent } from './networkProbe';

/** Explicit experiment surface inside the existing Telegram-only diagnostic entry. */
export function CommunicationsNetworkDiagnostic() {
  const [ticket, setTicket] = useState<StorageTicket | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('Подготовьте только несекретное тестовое видео до 3 минут.');
  const [results, setResults] = useState<ProbeResult[]>([]);
  const [copied, setCopied] = useState(false);
  const ticketInput = useRef<HTMLInputElement>(null);
  const mediaInput = useRef<HTMLInputElement>(null);
  const active = useRef<AbortController | null>(null);
  const ticketGeneration = useRef(0);
  const events = useRef<UploadEvent[]>([]);
  const dropped = useRef(0);
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; ticketGeneration.current++; active.current?.abort(); };
  }, []);

  const loadTicket = async (value: File | undefined) => {
    const generation = ++ticketGeneration.current;
    setTicket(null);
    if (!value || value.size > 32768) { setNote('Выберите небольшой JSON-файл подписей.'); return; }
    try {
      const parsed: unknown = JSON.parse(await value.text());
      const next = parseStorageTicket(parsed);
      if (mounted.current && generation === ticketGeneration.current) { setTicket(next); setNote('Подписи загружены в память. В отчёт они не попадут.'); }
    } catch {
      if (mounted.current && generation === ticketGeneration.current) setNote('Файл подписей не прошёл проверку. Не выбирайте файл с ключами.');
    }
  };

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

  const storage = (video: boolean) => run(async signal => {
    if (!ticket) return [];
    const blob = video ? file : new Blob([new Uint8Array(1024).fill(37)], { type: 'application/octet-stream' });
    if (!blob || (video && blob.type !== 'video/mp4') || !new URL(ticket.put).pathname.endsWith(video ? '.mp4' : '.bin')) {
      setNote('Для маленького файла нужны подписи .bin; для MP4 — подписи .mp4 и выбранное видео.'); return [];
    }
    // 64 MiB is an explicit diagnostic memory/traffic budget, not a product video limit.
    if (!blob.size || blob.size > 64 * 1024 * 1024) { setNote('Для этого опыта выберите файл от 1 байта до 64 МиБ. Это лимит диагностики.'); return []; }
    if (video) await videoDuration(blob, signal);
    events.current = []; dropped.current = 0;
    const put = await uploadProbe(ticket, blob, signal, event => {
      if (events.current.length >= 200) { events.current.shift(); dropped.current++; }
      events.current.push(event);
    });
    return put.code === 'OK' ? [put, ...await probeStorageReads(ticket, blob, signal)] : [put];
  });

  const copyReport = async () => {
    const platform = getTelegramWebApp()?.platform;
    // Explicit allowlist: no File.name, initData, user IDs, request/error body or signed URLs.
    const report = { harness: HARNESS_VERSION, capturedAt: new Date().toISOString(), origin: location.origin,
      platform: platform === 'ios' || platform === 'android' ? platform : 'other',
      vpn: 'owner-must-record', coldStart: 'not-proven-by-this-panel',
      tokenRefresh: 'record-separately-with-addon', results, uploadEvents: events.current,
      omittedEvents: dropped.current, backgroundConclusion: 'requires-server-and-owner-observation' };
    try { await navigator.clipboard.writeText(JSON.stringify(report, null, 2)); if (mounted.current) setCopied(true); }
    catch { if (mounted.current) setNote('Копирование недоступно. Сделайте снимок только таблицы результатов.'); }
  };

  return <section aria-label="COMM-02: проверка сети без VPN">
    <Text variant="headline" role="heading" aria-level={2}>Проверка сети без VPN</Text>
    <p><Text variant="footnote">Версия диагностики: {HARNESS_VERSION}</Text></p>
    <p><Text variant="body">Сначала откройте приложение, затем выключите VPN. Холодный старт и обновление токенов проверяются отдельно по инструкции.</Text></p>
    <Button rounded strong disabled={busy} onClick={() => void run(signal => probeHosting(location.origin, signal))}>Проверить HTML и JS по сети</Button>
    <input hidden type="file" accept="application/json,.json" ref={ticketInput} onChange={event => {
      void loadTicket(event.currentTarget.files?.[0]); event.currentTarget.value = '';
    }} />
    <Button rounded disabled={busy} onClick={() => ticketInput.current?.click()}>Выбрать файл временных подписей</Button>
    <input hidden type="file" accept="video/mp4" ref={mediaInput} onChange={event => {
      setFile(event.currentTarget.files?.[0] ?? null); event.currentTarget.value = '';
    }} />
    <Button rounded disabled={busy} onClick={() => mediaInput.current?.click()}>Выбрать тестовое MP4</Button>
    <Button rounded strong disabled={busy || !ticket} onClick={() => void storage(false)}>Проверить маленький файл</Button>
    <Button rounded strong disabled={busy || !ticket || !file} onClick={() => void storage(true)}>Загрузить и проверить MP4</Button>
    <Button rounded disabled={!busy} onClick={() => active.current?.abort()}>Остановить проверку</Button>
    <p role="status"><Text variant="body">{busy ? 'Идёт проверка. При опыте с MP4 сверните Telegram и вернитесь.' : note}</Text></p>
    {results.map((result, index) => <p key={index}><Text variant="footnote">{result.step}: {result.code}; HTTP {result.status ?? '—'}; {result.elapsedMs} мс</Text></p>)}
    <Button rounded disabled={busy || !results.length} onClick={() => void copyReport()}>{copied ? 'Отчёт скопирован' : 'Скопировать безопасный отчёт'}</Button>
    <p><Text variant="caption">Временные подписи остаются только в памяти. Закройте эту панель, чтобы их убрать. Повтор PUT отправляет весь файл заново; это не multipart-resume. Не выбирайте личные медиа.</Text></p>
  </section>;
}
