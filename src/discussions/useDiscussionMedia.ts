import { useEffect, useRef, useState } from 'react';
import { MediaUploadError, uploadDirectMedia } from '../media/directMediaUpload';
import { readDiscussionMedia, storeDiscussionMedia } from '../media/discussionMediaCache';
import { prepareDiscussionMessage, type DiscussionMessageInput } from '../data/cloud/discussions';
import type { DiscussionMessageView } from '../data/cloud/discussion-views';
import type { DiscussionPort } from './discussion-session';
import { inspectDiscussionMedia, prepareDiscussionVoice, prepareDiscussionVideoNote } from './discussion-media-file';
import type { VoiceRecording } from '../voice-note/useVoiceRecorder';
import type { VideoNoteRecording } from '../video-note/useVideoNoteRecorder';
import type { useDiscussionDraft } from './useDiscussionDraft';

type Selection = Awaited<ReturnType<typeof inspectDiscussionMedia>> & { separate?: DiscussionMessageInput; restored?: boolean };
type Phase = 'idle' | 'checking' | 'uploading' | 'publishing' | 'clearing' | 'failed';
type OutgoingMedia = Pick<DiscussionMessageInput, 'id' | 'createdAt'> & { attachmentId: string };

export function useDiscussionMedia(repository: DiscussionPort, draft: ReturnType<typeof useDiscussionDraft>) {
  const [selection, setSelection] = useState<Selection>();
  const [preview, setPreview] = useState<string>();
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string>();
  const [outgoing, setOutgoing] = useState<OutgoingMedia>();
  const [published, setPublished] = useState<DiscussionMessageView>();
  const active = useRef<AbortController | null>(null);
  const publishing = useRef(false);
  const interrupted = useRef(false);
  const storedKey = useRef<string | undefined>(undefined);
  const resume = useRef<(() => void) | null>(null);

  useEffect(() => () => { active.current?.abort(); active.current = null; resume.current = null; }, []);
  useEffect(() => {
    if (!selection) { setPreview(undefined); return; }
    const url = URL.createObjectURL(selection.file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [selection]);
  const savedCapture = draft.media;
  const savedMessage = draft.mediaMessage;
  useEffect(() => {
    if (selection || !savedCapture) return;
    let current = true;
    const { storageKey, mimeType, sizeBytes, fileName } = savedCapture;
    void readDiscussionMedia({ accountId: repository.actorUserId, storageKey, mimeType, sizeBytes }).then(blob => {
      if (current && blob && !active.current) {
        storedKey.current = storageKey;
        setSelection({ file: new File([blob], fileName, { type: mimeType }), metadata: savedCapture, restored: true });
        if (savedMessage) {
          setOutgoing({ id: savedMessage.id, createdAt: savedMessage.createdAt, attachmentId: savedCapture.id });
          setPhase('failed');
        }
      }
    });
    return () => { current = false; };
  }, [repository.actorUserId, savedCapture, savedMessage, selection]);
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

  async function choose(file: File, { sendToThread }: { sendToThread?: string } = {}) {
    if (active.current) return;
    resume.current = null;
    const controller = new AbortController();
    active.current = controller;
    setError(undefined); setPhase('checking');
    try {
      const next = await inspectDiscussionMedia(file, controller.signal);
      if (active.current !== controller) return;
      const separate = sendToThread ? prepareDiscussionMessage(sendToThread, '') : undefined;
      const saved = separate ? undefined : draft.media;
      if (saved && (saved.fileName !== next.metadata.fileName
        || saved.sizeBytes !== next.metadata.sizeBytes || saved.mimeType !== next.metadata.mimeType
        || saved.durationSeconds !== next.metadata.durationSeconds)) {
        throw new Error('Выберите тот же файл или удалите прежнее вложение');
      }
      const selected = { ...next, metadata: saved ?? next.metadata, separate };
      setSelection(selected);
      if (separate) {
        active.current = null;
        void send(selected);
      } else setPhase('idle');
    } catch (reason) {
      if (active.current === controller) {
        setError(reason instanceof Error ? reason.message : 'Не удалось проверить файл');
        setPhase('failed');
      }
    } finally {
      if (active.current === controller) active.current = null;
    }
  }

  function chooseVoice(clip: VoiceRecording, immediately = false) {
    if (active.current || selection || draft.media) return;
    setError(undefined);
    try {
      const next = prepareDiscussionVoice(clip);
      setSelection(next);
      if (immediately) void send(next);
      else setPhase('idle');
    } catch {
      setError('Формат голосового не поддерживается или запись превышает 25 МБ');
      setPhase('failed');
    }
  }

  function sendVideoNote(clip: VideoNoteRecording, previewOnly = false) {
    if (active.current || selection || draft.media) return;
    setError(undefined);
    try {
      const next = prepareDiscussionVideoNote(clip);
      setSelection(next);
      if (previewOnly) setPhase('idle');
      else void send(next);
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
    let savingFile = true;
    const message = selected.separate ?? draft.mediaCommand();
    setOutgoing({ id: message.id, createdAt: message.createdAt, attachmentId: selected.metadata.id });
    setError(undefined); setPhase('uploading');
    try {
      const { storageKey, mimeType, sizeBytes } = selected.metadata;
      if (storedKey.current !== storageKey) {
        await storeDiscussionMedia({ accountId: repository.actorUserId, storageKey, mimeType, sizeBytes }, selected.file, true);
        storedKey.current = storageKey;
      }
      savingFile = false;
      // Finish the private draft even if the sheet closes while IndexedDB is writing.
      command = await draft.stageMedia({ ...selected.metadata, uploadState: 'uploading' }, selected.separate);
      if (controller.signal.aborted) throw new MediaUploadError('CANCELLED');
      if (!command) {
        if (active.current === controller) { setSelection(undefined); setOutgoing(undefined); setPhase('idle'); }
        return;
      }
      const result = await uploadDirectMedia(selected.file, { signal: controller.signal, retryKey: selected.metadata.storageKey });
      if (controller.signal.aborted) throw new MediaUploadError('CANCELLED');
      publishing.current = true;
      setPhase('publishing');
      const sent = await repository.send(command, result);
      draft.sent(command.id, selected.restored);
      if (active.current === controller) {
        if (sent.attachments?.length) setPublished(sent);
        setSelection(undefined); setOutgoing(undefined); setPhase('idle');
      }
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
        : network ? 'Mezfit облако недоступно. Проверьте сеть и повторите отправку'
        : reason instanceof MediaUploadError && reason.code === 'SIGNER_AUTH'
          ? 'Mezfit облако не разрешило загрузку. Переоткройте Mezfit в Telegram'
        : reason instanceof MediaUploadError && reason.code === 'SIGNER_UNAVAILABLE'
          ? 'Не удалось получить ссылку для загрузки. Повторите отправку'
        : reason instanceof MediaUploadError ? 'Хранилище не приняло файл. Повторите отправку'
        : savingFile ? 'Не удалось сохранить файл на устройстве. Освободите место и попробуйте ещё раз'
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
      if (selection?.separate) await repository.discardDraft?.(selection.separate.threadId, selection.separate.id);
      else await draft.clearMedia(selection?.restored);
      if (active.current !== controller) return;
      setSelection(undefined); setOutgoing(undefined); setError(undefined); setPhase('idle');
    } catch {
      if (active.current === controller) { setError('Не удалось убрать вложение'); setPhase('failed'); }
    } finally {
      if (active.current === controller) active.current = null;
    }
  }

  return { selection, preview, outgoing, published, setPublished, phase, error, choose, chooseVoice, sendVideoNote, send, remove,
    cancel: () => { resume.current = null; if (!publishing.current) active.current?.abort(); } };
}
