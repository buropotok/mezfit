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

export function DiscussionVideoSaveDialog({ target, onClose, onStatus }: {
  target: DiscussionVideoSaveTarget;
  onClose: () => void;
  onStatus: (message: string) => void;
}) {
  const [file, setFile] = useState<File | null>('file' in target ? target.file : null);
  const [loading, setLoading] = useState(!('file' in target));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [shareFailed, setShareFailed] = useState(false);
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

  const shareData = file ? { files: [file] } : null;
  const canShareVideo = !shareFailed && shareData && navigator.canShare?.(shareData) && typeof navigator.share === 'function';
  const cancelled = 'Сохранение отменено. Видео осталось в чате.';
  const finish = (message: string) => {
    if (!active.current) return;
    onStatus(message);
    onClose();
  };

  const share = async () => {
    if (!shareData || saving) return;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      await navigator.share(shareData);
      finish('Видео передано в системное меню. Если выбрали «Сохранить видео», проверьте галерею.');
    } catch (reason) {
      if (!active.current) return;
      if (reason instanceof DOMException && reason.name === 'AbortError') {
        setShareFailed(true);
        setNotice('Сохранение не завершилось. Видео осталось в чате.');
        return;
      }
      setShareFailed(true);
      setError('Системное меню не открылось. Можно попробовать скачать файл.');
    } finally {
      if (active.current) setSaving(false);
    }
  };

  const download = () => {
    if (saving || loading) return;
    setError('');
    setNotice('');
    if ('url' in target && navigator.onLine !== false) {
      const name = videoFileName(target.cache.mimeType);
      setSaving(true);
      if (requestTelegramFileDownload(target.url, name, accepted => {
        if (!active.current) return;
        setSaving(false);
        if (accepted) finish(`Запрос принят Telegram. Ищите «${name}» в загрузках.`);
        else setNotice(cancelled);
      })) return;
      setSaving(false);
    }
    if (!file) {
      setError('Видео недоступно для скачивания. Проверьте сеть и попробуйте ещё раз.');
      return;
    }
    try {
      downloadLocalFile(file);
      finish(`Запрос на скачивание отправлен. Ищите «${file.name}» в «Файлах» или «Загрузках».`);
    } catch {
      setError('Не удалось начать скачивание. Видео осталось в чате.');
    }
  };

  return <MezfitDialog opened title={<Text variant="headline">Сохранить видео</Text>} onBackdropClick={onClose}
    content={<>
      <Text>{loading ? 'Подготавливаем видео…' : canShareVideo
        ? 'В системном меню выберите «Сохранить видео», если этот пункт доступен.'
        : 'Скачанный файл можно найти в «Файлах» или «Загрузках».'}</Text>
      {notice && <div><Text variant="footnote" role="status">{notice}</Text></div>}
      {error && <div><Text variant="footnote" role="alert">{error}</Text></div>}
    </>}
    buttons={<>
      <MezfitDialogButton onClick={onClose}><Text>Отмена</Text></MezfitDialogButton>
      <MezfitDialogButton strong disabled={loading || saving} onClick={canShareVideo ? () => void share() : download}>
        <Text>{canShareVideo || loading ? 'Сохранить' : 'Скачать файл'}</Text>
      </MezfitDialogButton>
    </>} />;
}
