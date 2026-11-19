import { useEffect, useRef, useState } from 'react';
import { APP_ERROR_CODES, withErrorCode } from '../../shared/app-error-codes';
import { reportVideoRecordingFailure } from '../video-note/video-recording-diagnostics';
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
function sendFailureCode(reason: unknown, savingFile: boolean, aborted: boolean) {
  if (aborted || (reason instanceof MediaUploadError && reason.code === 'CANCELLED')) return APP_ERROR_CODES.MEDIA_SEND_CANCELLED;
  if (reason instanceof MediaUploadError) {
    if (reason.code === 'NETWORK') {
      return reason.stage === 'signer' ? APP_ERROR_CODES.MEDIA_SEND_NETWORK_SIGNER
        : reason.stage === 'put' ? APP_ERROR_CODES.MEDIA_SEND_NETWORK_PUT
        : reason.stage === 'head' ? APP_ERROR_CODES.MEDIA_SEND_NETWORK_HEAD
        : APP_ERROR_CODES.MEDIA_SEND_NETWORK_OTHER;
    }
    if (reason.code === 'TIMEOUT') return APP_ERROR_CODES.MEDIA_SEND_TIMEOUT;
    if (reason.code === 'SIGNER_AUTH') return APP_ERROR_CODES.MEDIA_SEND_AUTH;
    if (reason.code === 'SIGNER_UNAVAILABLE') return APP_ERROR_CODES.MEDIA_SEND_SIGNER_UNAVAILABLE;
    if (reason.code === 'HTTP') return APP_ERROR_CODES.MEDIA_SEND_STORAGE_HTTP;
    return APP_ERROR_CODES.MEDIA_SEND_STORAGE_UNKNOWN;
  }
  return savingFile ? APP_ERROR_CODES.MEDIA_SEND_LOCAL_SAVE : APP_ERROR_CODES.MEDIA_SEND_MESSAGE;
}

function describeSendError(reason: unknown, savingFile: boolean, aborted: boolean): string {
  const code = sendFailureCode(reason, savingFile, aborted);
  if (code === APP_ERROR_CODES.MEDIA_SEND_CANCELLED) return withErrorCode('Загрузка отменена. Можно повторить отправку', code);
  if (reason instanceof MediaUploadError) {
    if (reason.code === 'NETWORK' || reason.code === 'TIMEOUT') {
      return withErrorCode('Mezfit облако недоступно. Проверьте сеть и повторите отправку', code);
    }
    if (reason.code === 'SIGNER_AUTH') return withErrorCode('Mezfit облако не разрешило загрузку. Переоткройте Mezfit в Telegram', code);
    if (reason.code === 'SIGNER_UNAVAILABLE') return withErrorCode('Не удалось получить ссылку для загрузки. Повторите отправку', code);
    return withErrorCode('Хранилище не приняло файл. Повторите отправку', code);
  }
  return withErrorCode(savingFile
    ? 'Не удалось сохранить файл на устройстве. Освободите место и попробуйте ещё раз'
    : 'Не удалось сохранить сообщение. Повторите отправку', code);
}

export function useDiscussionMedia(repository: DiscussionPort, draft: ReturnType<typeof useDiscussionDraft>, enabled = true) {
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const [selection, setSelection] = useState<Selection>();
  const selectionRef = useRef<Selection | undefined>(selection);
  selectionRef.current = selection;
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
  useEffect(() => {
    if (enabled) return;
    resume.current = null;
    const controller = active.current;
    active.current = null;
    controller?.abort();
    publishing.current = false;
    for (const entry of pendingRef.current) if (entry.preview) URL.revokeObjectURL(entry.preview);
    pendingRef.current = [];
    setPendingMedia([]);
    setSelection(undefined);
    setOutgoing(undefined);
    setPublished(undefined);
    setError(undefined);
    setPhase('idle');
  }, [enabled]);
  // Recover private, unsent media independently of the editable text composer.
  useEffect(() => {
    if (!enabled || !repository.listPendingMediaDrafts) return;
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
  }, [repository, repository.actorUserId, draft.threadId, enabled]);
  useEffect(() => {
    if (!selection) { setPreview(undefined); return; }
    const url = URL.createObjectURL(selection.file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [selection]);
  const savedCapture = draft.media;
  const savedMessage = draft.mediaMessage;
  useEffect(() => {
    if (!enabled || selection || !savedCapture) return;
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
  }, [repository.actorUserId, savedCapture, savedMessage, selection, enabled]);
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
    if (!enabledRef.current || active.current) return false;
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
          setError(reason instanceof Error ? reason.message : withErrorCode('Не удалось проверить файл', APP_ERROR_CODES.MEDIA_INVALID_FORMAT));
          setPhase('failed');
        }
      }
      return false;
    } finally {
      if (active.current === controller) active.current = null;
    }
  }

  function chooseVoice(clip: VoiceRecording, immediately = false) {
    if (!enabledRef.current || active.current || selection || draft.media) return;
    setError(undefined);
    try {
      const next = prepareDiscussionVoice(clip);
      setSelection(next);
      if (immediately) void send(next);
      else setPhase('idle');
    } catch {
      setError(withErrorCode('Формат голосового не поддерживается или запись превышает 25 МБ', APP_ERROR_CODES.MEDIA_VOICE_UNSUPPORTED));
      reportVideoRecordingFailure(APP_ERROR_CODES.MEDIA_VOICE_UNSUPPORTED, 'voice');
      setPhase('failed');
    }
  }

  function sendVideoNote(clip: VideoNoteRecording, previewOnly = false) {
    if (!enabledRef.current || active.current || selection || draft.media) return;
    setError(undefined);
    try {
      const next = prepareDiscussionVideoNote(clip);
      setSelection(next);
      if (previewOnly) setPhase('idle');
      else void send(next);
    } catch {
      setError(withErrorCode('Не удалось подготовить видеокружок. Проверьте формат и размер записи.', APP_ERROR_CODES.MEDIA_VIDEO_NOTE_INVALID));
      reportVideoRecordingFailure(APP_ERROR_CODES.MEDIA_VIDEO_NOTE_INVALID, 'media');
      setPhase('failed');
    }
  }

  async function send(selected = selection, allowResume = true) {
    if (!enabledRef.current || !selected || active.current) return;
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
      if (!enabledRef.current || controller.signal.aborted) throw new MediaUploadError('CANCELLED');
      if (!command) {
        if (active.current === controller) { setSelection(undefined); setOutgoing(undefined); setPhase('idle'); }
        return;
      }
      const result = await uploadMirroredDiscussionMedia(selected.file, {
        accountId: repository.actorUserId, signal: controller.signal, retryKey: selected.metadata.storageKey,
      });
      if (!enabledRef.current || controller.signal.aborted) throw new MediaUploadError('CANCELLED');
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
      const errorText = describeSendError(reason, savingFile, controller.signal.aborted);
      if (sendFailureCode(reason, savingFile, controller.signal.aborted) !== APP_ERROR_CODES.MEDIA_SEND_CANCELLED) {
        reportVideoRecordingFailure(sendFailureCode(reason, savingFile, controller.signal.aborted), 'media', {
          mediaMimeType: selected.metadata.mimeType,
          mediaSizeBytes: String(selected.metadata.sizeBytes),
          ...(reason instanceof MediaUploadError ? {
            mediaUploadStage: reason.stage,
            mediaUploadStatus: reason.status === undefined ? undefined : String(reason.status),
          } : {}),
        });
      }
      if (command) {
        // Network failure is not a failed local save. Keep the private draft and
        // cached bytes for independent retry; free Messagebar for the next message.
        const detached = { ...selected, separate: command, restored: true };
        enqueuePending({ command, selected: detached, preview: URL.createObjectURL(selected.file), error: errorText });
        draft.detachMedia(command.id);
        setSelection(undefined); setOutgoing(undefined); setError(undefined); setPhase('idle');
      } else {
        setError(errorText);
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
    if (!enabledRef.current || !entry?.selected || active.current || selectionRef.current) return;
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
