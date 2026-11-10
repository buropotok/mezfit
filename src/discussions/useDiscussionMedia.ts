import { useEffect, useRef, useState } from 'react';
import { MediaUploadError, uploadDirectMedia } from '../media/directMediaUpload';
import { readDiscussionMedia, storeDiscussionMedia } from '../media/discussionMediaCache';
import type { DiscussionMessageInput } from '../data/cloud/discussions';
import type { DiscussionPort } from './discussion-session';
import { inspectDiscussionMedia, prepareDiscussionVoice, prepareDiscussionVideoNote } from './discussion-media-file';
import type { VoiceRecording } from '../voice-note/useVoiceRecorder';
import type { VideoNoteRecording } from '../video-note/useVideoNoteRecorder';
import type { useDiscussionDraft } from './useDiscussionDraft';

type Selection = Awaited<ReturnType<typeof inspectDiscussionMedia>>;
type Phase = 'idle' | 'checking' | 'uploading' | 'publishing' | 'clearing' | 'failed';

export function useDiscussionMedia(repository: DiscussionPort, draft: ReturnType<typeof useDiscussionDraft>) {
  const [selection, setSelection] = useState<Selection>();
  const [preview, setPreview] = useState<string>();
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string>();
  const active = useRef<AbortController | null>(null);
  const publishing = useRef(false);
  const interrupted = useRef(false);
  const resume = useRef<(() => void) | null>(null);

  useEffect(() => () => { active.current?.abort(); active.current = null; resume.current = null; }, []);
  useEffect(() => {
    if (!selection) { setPreview(undefined); return; }
    const url = URL.createObjectURL(selection.file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [selection]);
  const savedCapture = draft.media?.mediaType === 'voice' || draft.media?.mediaType === 'video-note' ? draft.media : undefined;
  useEffect(() => {
    if (selection || !savedCapture) return;
    let current = true;
    const { storageKey, mimeType, sizeBytes, fileName } = savedCapture;
    void readDiscussionMedia({ accountId: repository.actorUserId, storageKey, mimeType, sizeBytes }).then(blob => {
      if (current && blob && !active.current) {
        setSelection({ file: new File([blob], fileName, { type: mimeType }), metadata: savedCapture });
      }
    });
    return () => { current = false; };
  }, [repository.actorUserId, savedCapture, selection]);
  useEffect(() => {
    const retry = () => {
      if (document.visibilityState === 'hidden' || navigator.onLine === false) {
        if (active.current) interrupted.current = true;
        return;
      }
      const operation = resume.current;
      resume.current = null;
      operation?.();
    };
    document.addEventListener('visibilitychange', retry);
    window.addEventListener('online', retry);
    window.addEventListener('offline', retry);
    return () => {
      document.removeEventListener('visibilitychange', retry);
      window.removeEventListener('online', retry);
      window.removeEventListener('offline', retry);
    };
  }, []);

  async function choose(file: File) {
    if (active.current) return;
    resume.current = null;
    const controller = new AbortController();
    active.current = controller;
    setError(undefined); setPhase('checking');
    try {
      const next = await inspectDiscussionMedia(file, controller.signal);
      if (active.current !== controller) return;
      const saved = draft.media;
      if (saved && (saved.fileName !== next.metadata.fileName
        || saved.sizeBytes !== next.metadata.sizeBytes || saved.mimeType !== next.metadata.mimeType
        || saved.durationSeconds !== next.metadata.durationSeconds)) {
        throw new Error('Выберите тот же файл или удалите прежнее вложение');
      }
      setSelection({ ...next, metadata: saved ?? next.metadata });
      setPhase('idle');
    } catch (reason) {
      if (active.current === controller) {
        setError(reason instanceof Error ? reason.message : 'Не удалось проверить файл');
        setPhase('failed');
      }
    } finally {
      if (active.current === controller) active.current = null;
    }
  }

  function chooseVoice(clip: VoiceRecording) {
    if (active.current || selection || draft.media) return;
    setError(undefined);
    try {
      setSelection(prepareDiscussionVoice(clip));
      setPhase('idle');
    } catch {
      setError('Формат голосового не поддерживается или запись превышает 25 МБ');
      setPhase('failed');
    }
  }

  function sendVideoNote(clip: VideoNoteRecording) {
    if (active.current || selection || draft.media) return;
    setError(undefined);
    try {
      const next = prepareDiscussionVideoNote(clip);
      setSelection(next);
      // Upload and publication begin without the MessageBar preview/Send step.
      void send(next);
    } catch {
      setError('Не удалось подготовить видеокружок. Проверьте формат и размер записи.');
      setPhase('failed');
    }
  }

  async function send(selected = selection, allowResume = true) {
    if (!selected || active.current) return;
    resume.current = null;
    const controller = new AbortController();
    active.current = controller;
    interrupted.current = document.visibilityState === 'hidden' || navigator.onLine === false;
    let command: DiscussionMessageInput | null = null;
    setError(undefined); setPhase('uploading');
    try {
      if (selected.metadata.mediaType === 'voice' || selected.metadata.mediaType === 'video-note') {
        const { storageKey, mimeType, sizeBytes } = selected.metadata;
        await storeDiscussionMedia({ accountId: repository.actorUserId, storageKey, mimeType, sizeBytes }, selected.file);
        if (controller.signal.aborted) throw new MediaUploadError('CANCELLED');
      }
      command = await draft.stageMedia({ ...selected.metadata, uploadState: 'uploading' });
      if (controller.signal.aborted) throw new MediaUploadError('CANCELLED');
      if (!command) {
        if (active.current === controller) { setSelection(undefined); setPhase('idle'); }
        return;
      }
      const result = await uploadDirectMedia(selected.file, { signal: controller.signal, retryKey: selected.metadata.storageKey });
      if (controller.signal.aborted) throw new MediaUploadError('CANCELLED');
      publishing.current = true;
      setPhase('publishing');
      if (selected.metadata.mediaType !== 'voice' && selected.metadata.mediaType !== 'video-note') await storeDiscussionMedia({ accountId: repository.actorUserId, storageKey: result.key,
        mimeType: result.contentType, sizeBytes: result.sizeBytes }, selected.file);
      await repository.send(command, result);
      draft.sent(command.id);
      if (active.current === controller) { setSelection(undefined); setPhase('idle'); }
    } catch (reason) {
      if (command) {
        try { await repository.updateDraftMedia?.(command.threadId, command.id, selected.metadata.storageKey, 'failed'); }
        catch { /* An uploading draft is also recoverable after reopening. */ }
      }
      if (active.current !== controller) return;
      const network = reason instanceof MediaUploadError && (reason.code === 'NETWORK' || reason.code === 'TIMEOUT');
      if (allowResume && network && interrupted.current && !controller.signal.aborted) {
        if (document.visibilityState !== 'hidden' && navigator.onLine !== false) {
          active.current = null;
          publishing.current = false;
          void send(selected, false);
          return;
        }
        resume.current = () => { void send(selected, false); };
      }
      setError(controller.signal.aborted ? 'Загрузка отменена. Можно повторить отправку'
        : network ? 'Не удалось связаться с Яндексом. Проверьте сеть и повторите отправку'
        : reason instanceof MediaUploadError && reason.code === 'SIGNER_AUTH'
          ? 'Яндекс не разрешил загрузку. Переоткройте Mezfit в Telegram'
        : reason instanceof MediaUploadError && reason.code === 'SIGNER_UNAVAILABLE'
          ? 'Не удалось получить ссылку для загрузки. Повторите отправку'
        : reason instanceof MediaUploadError ? 'Хранилище не приняло файл. Повторите отправку'
        : 'Не удалось сохранить сообщение. Повторите отправку');
      setPhase('failed');
    } finally {
      if (active.current === controller) {
        publishing.current = false;
        active.current = null;
        if (controller.signal.aborted) {
          setError('Загрузка отменена. Можно повторить отправку');
          setPhase('failed');
        }
      }
    }
  }

  async function remove() {
    if (active.current) return;
    resume.current = null;
    const controller = new AbortController();
    active.current = controller;
    setPhase('clearing');
    try {
      await draft.clearMedia();
      if (active.current !== controller) return;
      setSelection(undefined); setError(undefined); setPhase('idle');
    } catch {
      if (active.current === controller) { setError('Не удалось убрать вложение'); setPhase('failed'); }
    } finally {
      if (active.current === controller) active.current = null;
    }
  }

  return { selection, preview, phase, error, choose, chooseVoice, sendVideoNote, send, remove,
    cancel: () => { resume.current = null; if (!publishing.current) active.current?.abort(); } };
}
