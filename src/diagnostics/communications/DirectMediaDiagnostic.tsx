import { useEffect, useRef, useState } from 'react';
import { Button } from 'konsta/react';
import { Text } from '../../ui';
import { MEDIA_FILE_ACCEPT, MediaUploadError, uploadDirectMedia, type UploadedMedia } from '../../media/directMediaUpload';

function describeError(error: unknown): string {
  if (!(error instanceof MediaUploadError)) return 'Загрузка не удалась.';
  switch (error.code) {
    case 'INVALID_KEY': return 'Некорректный ключ файла.';
    case 'INVALID_TYPE': return 'Выберите фото, видео или аудио поддерживаемого формата.';
    case 'INVALID_SIZE': return 'Файл пустой или превышает лимит для своего формата.';
    case 'CANCELLED': return 'Загрузка отменена.';
    case 'TIMEOUT': return 'Время загрузки истекло. Можно повторить.';
    case 'NETWORK': return 'Нет ответа от Яндекса. Проверьте сеть и настройки CORS.';
    case 'SIGNER_AUTH': return 'Яндекс не разрешил загрузку. Переоткройте Mezfit в Telegram.';
    case 'SIGNER_UNAVAILABLE': return 'Не удалось получить ссылку для загрузки.';
    case 'HTTP': {
      const details = [error.s3Code, error.s3Message].filter(Boolean).join(': ');
      return `Хранилище отклонило загрузку (HTTP ${error.status}${details ? `; S3 ${details}` : ''}).`;
    }
  }
}

export function DirectMediaDiagnostic() {
  const input = useRef<HTMLInputElement>(null);
  const active = useRef<AbortController | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [result, setResult] = useState<UploadedMedia | null>(null);

  useEffect(() => () => {
    active.current?.abort();
    active.current = null;
  }, []);

  async function upload() {
    if (!file || active.current) return;
    const controller = new AbortController();
    active.current = controller;
    setBusy(true);
    setStatus('Загрузка…');
    setResult(null);
    try {
      const next = await uploadDirectMedia(file, { signal: controller.signal });
      if (active.current !== controller) return;
      setResult(next);
      setStatus('Файл загружен.');
    } catch (error) {
      if (active.current === controller) setStatus(describeError(error));
    } finally {
      if (active.current === controller) {
        active.current = null;
        setBusy(false);
      }
    }
  }

  return <section aria-label="Прямая загрузка медиа">
    <Text variant="headline" role="heading" aria-level={3}>Прямая загрузка медиа</Text>
    <p><Text variant="body">Выберите тестовый файл. Его сможет открыть любой, у кого есть ссылка.</Text></p>
    <input hidden type="file" accept={MEDIA_FILE_ACCEPT} ref={input} disabled={busy} onChange={event => {
      setFile(event.currentTarget.files?.[0] ?? null);
      event.currentTarget.value = '';
      setResult(null);
      setStatus('');
    }} />
    <Button rounded disabled={busy} onClick={() => input.current?.click()}>Выбрать файл</Button>
    {file && <p><Text variant="footnote">{file.name}</Text></p>}
    <Button rounded disabled={!file || busy} onClick={() => void upload()}>{status && !busy && !result ? 'Повторить загрузку' : 'Загрузить'}</Button>
    {busy && <Button rounded onClick={() => active.current?.abort()}>Отменить загрузку</Button>}
    <p role="status"><Text variant="body">{status}</Text></p>
    {result && <>
      <p><Text variant="footnote">{result.contentType} · {result.sizeBytes} байт</Text></p>
      <a href={result.url} target="_blank" rel="noopener noreferrer"><Text variant="body">Открыть загруженный файл</Text></a>
    </>}
  </section>;
}
