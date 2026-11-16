import { useEffect, useRef, useState } from 'react';
import type { MessageAttachment } from '../data/cloud/discussion-contracts';
import { downloadDiscussionMedia, readDiscussionMedia, type DiscussionMediaCacheEntry } from '../media/discussionMediaCache';
import { requestTelegramFileDownload } from '../telegram';
import { MezfitDialog, MezfitDialogButton } from '../ui/konsta-mezfit/Dialog';
import { Text } from '../ui/primitives';

export type DiscussionAttachmentSaveTarget =
  ({ file: File } | { url: string; cache: DiscussionMediaCacheEntry })
  & { mediaType?: MessageAttachment['mediaType'] };
/** Existing video callers and tests retain their public contract. */
export type DiscussionVideoSaveTarget = DiscussionAttachmentSaveTarget;

function attachmentLabel(type: MessageAttachment['mediaType']): string {
  switch (type) {
    case 'photo': return 'Фото';
    case 'voice': return 'Голосовое сообщение';
    case 'video-note': return 'Видеокружок';
    case 'video': return 'Видео';
  }
}

/** Published metadata has no original filename; choose a safe extension from its MIME type. */
export function discussionAttachmentFileName(type: MessageAttachment['mediaType'], mimeType: string): string {
  const mime = mimeType.split(';', 1)[0].toLowerCase();
  if (type === 'video' || type === 'video-note') {
    if (mime === 'video/webm') return `${attachmentLabel(type)} Mezfit.webm`;
    if (mime === 'video/quicktime') return `${attachmentLabel(type)} Mezfit.mov`;
    return `${attachmentLabel(type)} Mezfit.mp4`;
  }
  if (type === 'photo') {
    const extension = ({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp',
      'image/heic': 'heic', 'image/heif': 'heif', 'image/avif': 'avif', 'image/gif': 'gif' } as Record<string, string>)[mime] ?? 'bin';
    return `Фото Mezfit.${extension}`;
  }
  const extension = ({ 'audio/ogg': 'ogg', 'audio/webm': 'webm', 'audio/mpeg': 'mp3',
    'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a', 'audio/wav': 'wav', 'audio/x-wav': 'wav',
    'audio/aac': 'aac', 'audio/amr': 'amr' } as Record<string, string>)[mime] ?? 'bin';
  return `Голосовое Mezfit.${extension}`;
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

export function DiscussionAttachmentSaveDialog({ target, onClose, onStatus }: {
  target: DiscussionAttachmentSaveTarget;
  onClose: () => void;
  onStatus: (message: string) => void;
}) {
  const mediaType = target.mediaType ?? 'video';
  const label = attachmentLabel(mediaType);
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
          if (current && blob) setFile(new File([blob], discussionAttachmentFileName(mediaType, entry.mimeType), { type: entry.mimeType }));
        } finally {
          if (current) setLoading(false);
        }
      })().catch(() => {
        if (current) setError(`Не удалось подготовить ${label.toLowerCase()}. Попробуйте скачать файл через Telegram.`);
      });
    }
    return () => { current = false; active.current = false; };
  }, [target, mediaType, label]);

  const shareData = file ? { files: [file] } : null;
  const canShare = !shareFailed && shareData && navigator.canShare?.(shareData) && typeof navigator.share === 'function';
  const retained = mediaType === 'video-note' ? 'Видеокружок остался в чате.' : `${label} осталось в чате.`;
  const cancelled = `Сохранение отменено. ${retained}`;
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
      finish(mediaType === 'video'
        ? 'Видео передано в системное меню. Если выбрали «Сохранить видео», проверьте галерею.'
        : `${label} передано в системное меню. Проверьте, куда устройство сохранило файл.`);
    } catch (reason) {
      if (!active.current) return;
      if (reason instanceof DOMException && reason.name === 'AbortError') {
        setShareFailed(true);
        setNotice(`Сохранение не завершилось. ${retained}`);
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
      const name = discussionAttachmentFileName(mediaType, target.cache.mimeType);
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
      setError(`${label} недоступно для скачивания. Проверьте сеть и попробуйте ещё раз.`);
      return;
    }
    try {
      downloadLocalFile(file);
      finish(`Запрос на скачивание отправлен. Ищите «${file.name}» в «Файлах» или «Загрузках».`);
    } catch {
      setError(`Не удалось начать скачивание. ${retained}`);
    }
  };

  return <MezfitDialog opened title={<Text variant="headline">Сохранить {label.toLowerCase()}</Text>} onBackdropClick={onClose}
    content={<>
      <Text>{loading ? `Подготавливаем ${label.toLowerCase()}…` : canShare
        ? (mediaType === 'video' ? 'В системном меню выберите «Сохранить видео», если этот пункт доступен.'
          : 'В системном меню выберите сохранение файла, если этот пункт доступен.')
        : 'Скачанный файл можно найти в «Файлах» или «Загрузках».'}</Text>
      {notice && <div><Text variant="footnote" role="status">{notice}</Text></div>}
      {error && <div><Text variant="footnote" role="alert">{error}</Text></div>}
    </>}
    buttons={<>
      <MezfitDialogButton onClick={onClose}><Text>Отмена</Text></MezfitDialogButton>
      <MezfitDialogButton strong disabled={loading || saving} onClick={canShare ? () => void share() : download}>
        <Text>{canShare || loading ? 'Сохранить' : 'Скачать файл'}</Text>
      </MezfitDialogButton>
    </>} />;
}

/** Compatibility export for callers of the original video-only dialog. */
export const DiscussionVideoSaveDialog = DiscussionAttachmentSaveDialog;
