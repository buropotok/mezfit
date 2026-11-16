import { useEffect, useRef, useState } from 'react';
import { MediaUploadError } from '../media/directMediaUpload';
import { uploadMirroredDiscussionMedia, acceptMediaReplica, resumeMediaReplicaUploads } from '../media/dualMediaUpload';
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
interface PendingMedia {
  command: DiscussionMessageInput;
  selected?: Selection;
  preview?: string;
  error: string;
}

// Stable, non-sensitive support codes for failures in the media send flow.
// 1/2/3 identify the failed network request: signer, PUT, or retry HEAD.
function describeSendError(reason: unknown, savingFile: boolean, aborted: boolean): string {
  if (aborted || (reason instanceof MediaUploadError && reason.code === 'CANCELLED')) {
    return 'Загрузка отменена. Можно повторить отправку (Код 12)';
  }
  if (reason instanceof MediaUploadError) {
    if (reason.code === 'NETWORK') {
      const code = reason.stage === 'signer' ? 1 : reason.stage === 'put' ? 2
        : reason.stage === 'head' ? 3 : 4;
      return `Mezfit облако недоступно. Проверьте сеть и повторите отправку (Код ${code})`;
    }
    if (reason.code === 'TIMEOUT') return 'Mezfit облако недоступно. Проверьте сеть и повторите отправку (Код 5)';
    if (reason.code === 'SIGNER_AUTH') return 'Mezfit облако не разрешило загрузку. Переоткройте Mezfit в Telegram (Код 6)';
    if (reason.code === 'SIGNER_UNAVAILABLE') return 'Не удалось получить ссылку для загрузки. Повторите отправку (Код 7)';
    if (reason.code === 'HTTP') return 'Хранилище не приняло файл. Повторите отправку (Код 8)';
    return 'Хранилище не приняло файл. Повторите отправку (Код 9)';
  }
  if (savingFile) return 'Не удалось сохранить файл на устройстве. Освободите место и попробуйте ещё раз (Код 10)';
  return 'Не удалось сохранить сообщение. Повторите отправку (Код 11)';
}

export function useDiscussionMedia(repository: DiscussionPort, draft: ReturnType<typeof useDiscussionDraft>) {
  const [selection, setSelection] = useState<Selection>();
  const [preview, setPreview] = useState<string>();
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string>();
  const [outgoing, setOutgoing] = useState<OutgoingMedia>();
  const [published, setPublished] = useState<DiscussionMessageView>();
  const [pendingMedia, setPendingMedia] = useState<PendingMedia[]>([]);
  const pendingRef = useRef<PendingMedia[]>([]);
  const updatePending = (next: PendingMedia[]) => { pendingRef.current = next; setPendingMedia(next); };
  const enqueuePending = (entry: PendingMedia) => {
    const existing = pendingRef.current.find(row => row.command.id === entry.command.id);
    if (existing?.preview) URL.revokeObjectURL(existing.preview);
    updatePending([...pendingRef.current.filter(row => row.command.id !== entry.command.id), entry]);
  };
  const active = useRef<AbortController | null>(null);
  const publishing = useRef(false);
  const interrupted = useRef(false);
  const storedKey = useRef<string | undefined>(undefined);
  const resume = useRef<(() => void) | null>(null);

  useEffect(() => () => {
    active.current?.abort(); active.current = null; resume.current = null;
    for (const entry of pendingRef.current) if (entry.preview) URL.revokeObjectURL(entry.preview);
  }, []);
  // Recover private, unsent media independently of the editable text composer.
  useEffect(() => {
    if (!repository.listPendingMediaDrafts) return;
    let alive = true;
    void repository.listPendingMediaDrafts(draft.threadId).then(async commands => {
      for (const command of commands) {
        const metadata = command.draftMedia;
        if (!metadata) continue;
        const { storageKey, mimeType, sizeBytes, fileName } = metadata;
        const blob = await readDiscussionMedia({ accountId: repository.actorUserId, storageKey, mimeType, sizeBytes })
          .catch(() => undefined);
        if (!alive) return;
        const file = blob ? new File([blob], fileName, { type: mimeType }) : undefined;
        if (pendingRef.current.some(row => row.command.id === command.id)) continue;
        enqueuePending({ command, selected: file ? { file, metadata, separate: command, restored: true } : undefined,
          preview: file ? URL.createObjectURL(file) : undefined,
          error: file ? 'Файл сохранён на устройстве. Отправка не завершена.' : 'Локальный файл недоступен. Отмените отправку.' });
      }
    }).catch(() => undefined);
    return () => { alive = false; };
  }, [repository, repository.actorUserId, draft.threadId]);
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

  async function choose(file: File, { sendToThread, onSelected }: {
    sendToThread?: string;
    onSelected?: () => boolean;
  } = {}) {
    if (active.current) return false;
    resume.current = null;
    const controller = new AbortController();
    active.current = controller;
    setError(undefined); setPhase('checking');
    try {
      const next = await inspectDiscussionMedia(file, controller.signal);
      if (active.current !== controller) return false;
      if (controller.signal.aborted) { setPhase('idle'); return false; }
      const separate = sendToThread ? prepareDiscussionMessage(sendToThread, '') : undefined;
      const saved = separate ? undefined : draft.media;
      if (saved && (saved.fileName !== next.metadata.fileName
        || saved.sizeBytes !== next.metadata.sizeBytes || saved.mimeType !== next.metadata.mimeType
        || saved.durationSeconds !== next.metadata.durationSeconds)) {
        throw new Error('Выберите тот же файл или удалите прежнее вложение');
      }
      const selected = { ...next, metadata: saved ?? next.metadata, separate };
      if (onSelected?.() === false) { setPhase('idle'); return false; }
      setSelection(selected);
      if (separate) {
        active.current = null;
        void send(selected);
      } else setPhase('idle');
      return true;
    } catch (reason) {
      if (active.current === controller) {
        if (controller.signal.aborted) setPhase('idle');
        else {
          setError(reason instanceof Error ? reason.message : 'Не удалось проверить файл');
          setPhase('failed');
        }
      }
      return false;
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
      const result = await uploadMirroredDiscussionMedia(selected.file, {
        accountId: repository.actorUserId, signal: controller.signal, retryKey: selected.metadata.storageKey,
      });
      if (controller.signal.aborted) throw new MediaUploadError('CANCELLED');
      publishing.current = true;
      setPhase('publishing');
      const sent = await repository.send(command, result);
      // Upload replication state is operational; a cache failure must not undo publication.
      await acceptMediaReplica(repository.actorUserId, result.key).catch(() => undefined);
      void resumeMediaReplicaUploads(repository.actorUserId);
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
        resume.current = () => { retryPending(message.id); };
      }
      const message = describeSendError(reason, savingFile, controller.signal.aborted);
      if (command) {
        // Network failure is not a failed local save. Keep the private draft and
        // cached bytes for independent retry; free Messagebar for the next message.
        const detached = { ...selected, separate: command, restored: true };
        enqueuePending({ command, selected: detached, preview: URL.createObjectURL(selected.file), error: message });
        draft.detachMedia(command.id);
        setSelection(undefined); setOutgoing(undefined); setError(undefined); setPhase('idle');
      } else {
        setError(message);
        setPhase('failed');
      }
    } finally {
      if (active.current === controller) {
        publishing.current = false;
        active.current = null;
        if (controller.signal.aborted) {
          if (!command) {
            setError(describeSendError(new MediaUploadError('CANCELLED'), false, true));
            setPhase('failed');
          }
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

  function retryPending(id: string) {
    const entry = pendingRef.current.find(row => row.command.id === id);
    if (!entry?.selected || active.current || selection) return;
    updatePending(pendingRef.current.filter(row => row.command.id !== id));
    if (entry.preview) URL.revokeObjectURL(entry.preview);
    setSelection(entry.selected);
    void send(entry.selected);
  }

  async function removePending(id: string) {
    const entry = pendingRef.current.find(row => row.command.id === id);
    if (!entry || !repository.discardDraft) return;
    try {
      await repository.discardDraft(entry.command.threadId, entry.command.id);
      updatePending(pendingRef.current.filter(row => row.command.id !== id));
      if (entry.preview) URL.revokeObjectURL(entry.preview);
    } catch {
      updatePending(pendingRef.current.map(row => row.command.id === id
        ? { ...row, error: 'Не удалось отменить отправку. Повторите попытку.' } : row));
    }
  }

  return { selection, preview, outgoing, pendingMedia, published, setPublished, phase, error, choose, chooseVoice, sendVideoNote, send, remove,
    retryPending, removePending, cancel: () => { resume.current = null; if (!publishing.current) active.current?.abort(); } };
}
