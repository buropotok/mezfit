import { useEffect, useRef, useState } from 'react';
import { downloadDiscussionMedia, readDiscussionMedia, type DiscussionMediaCacheEntry } from '../media/discussionMediaCache';
import { requestTelegramFileDownload } from '../telegram';
import { MezfitDialog, MezfitDialogButton } from '../ui/konsta-mezfit/Dialog';
import { Text } from '../ui/primitives';

export type DiscussionVideoSaveTarget = { file: File } | { url: string; cache: DiscussionMediaCacheEntry };

function videoFileName(mimeType: string) {
  if (mimeType === 'video/webm') return 'Видео Mezfit.webm';
  if (mimeType === 'video/quicktime') return 'Видео Mezfit.mov';
  return 'Видео Mezfit.mp4';
}

function downloadLocalFile(file: File) {
  const url = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = url;
  link.download = file.name;
  document.body.appendChild(link);
  try {
    link.click();
  } finally {
    link.remove();
    // Give the WebView time to start reading the object after the click.
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}

export function DiscussionVideoSaveDialog({ target, onClose }: { target: DiscussionVideoSaveTarget; onClose: () => void }) {
  const [file, setFile] = useState<File | null>('file' in target ? target.file : null);
  const [loading, setLoading] = useState(!('file' in target));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const active = useRef(false);

  useEffect(() => {
    active.current = true;
    let current = true;
    if ('cache' in target) {
      const entry = target.cache;
      void (async () => {
        try {
          const cached = await readDiscussionMedia(entry);
          if (!current) return;
          const blob = cached ?? (navigator.onLine === false ? null : await downloadDiscussionMedia(entry));
          if (current && blob) setFile(new File([blob], videoFileName(entry.mimeType), { type: entry.mimeType }));
        } finally {
          if (current) setLoading(false);
        }
      })().catch(() => {
        if (current) setError('Не удалось подготовить видео. Попробуйте сохранить его через Telegram.');
      });
    }
    return () => { current = false; active.current = false; };
  }, [target]);

  const save = async () => {
    if (saving || loading) return;
    setSaving(true);
    setError('');
    try {
      if (file) {
        const data = { files: [file] };
        if (navigator.canShare?.(data) && navigator.share) {
          try {
            await navigator.share(data);
            if (active.current) onClose();
            return;
          } catch (reason) {
            if (reason instanceof DOMException && reason.name === 'AbortError') return;
          }
        }
        if (!active.current) return;
        downloadLocalFile(file);
        onClose();
        return;
      }
      if ('url' in target && navigator.onLine !== false
        && requestTelegramFileDownload(target.url, videoFileName(target.cache.mimeType))) {
        onClose();
        return;
      }
      setError('Видео недоступно для скачивания. Проверьте сеть и попробуйте ещё раз.');
    } catch {
      if (active.current) setError('Не удалось открыть системное сохранение видео.');
    } finally {
      if (active.current) setSaving(false);
    }
  };

  return <MezfitDialog opened title={<Text variant="headline">Сохранить видео</Text>} onBackdropClick={onClose}
    content={<>
      <Text>{loading ? 'Подготавливаем видео…' : file
        ? 'Выберите сохранение в галерею, если система предлагает такой пункт. На некоторых устройствах видео сохраняется в загрузки.'
        : 'Видео можно скачать через Telegram, если устройство подключено к сети.'}</Text>
      {error && <div><Text variant="footnote" role="alert">{error}</Text></div>}
    </>}
    buttons={<>
      <MezfitDialogButton onClick={onClose}><Text>Отмена</Text></MezfitDialogButton>
      <MezfitDialogButton strong disabled={loading || saving} onClick={() => void save()}>
        <Text>{file || loading ? 'Сохранить' : 'Скачать'}</Text>
      </MezfitDialogButton>
    </>} />;
}
