import { useEffect, useRef, useState } from 'react';
import { MediaUploadError, uploadDirectMedia } from '../media/directMediaUpload';
import type { DiscussionMessageInput } from '../data/cloud/discussions';
import type { DiscussionPort } from './discussion-session';
import { inspectDiscussionMedia } from './discussion-media-file';
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

  async function send(selected = selection, allowResume = true) {
    if (!selected || active.current) return;
    resume.current = null;
    const controller = new AbortController();
    active.current = controller;
    interrupted.current = document.visibilityState === 'hidden' || navigator.onLine === false;
    let command: DiscussionMessageInput | null = null;
    setError(undefined); setPhase('uploading');
    try {
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
        : network ? 'Не удалось связаться с хранилищем. Проверьте сеть и повторите отправку'
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

  return { selection, preview, phase, error, choose, send, remove,
    cancel: () => { resume.current = null; if (!publishing.current) active.current?.abort(); } };
}
