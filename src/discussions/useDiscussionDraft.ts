import { useEffect, useRef, useState } from 'react';
import { prepareDiscussionMessage, type DiscussionMessageInput } from '../data/cloud/discussions';
import type { DiscussionPort } from './discussion-session';

/** Draft records belong to the repository; this hook owns only composer presentation. */
export function useDiscussionDraft(repository: DiscussionPort, threadId: string) {
  const [text, setText] = useState('');
  const [replyId, setReplyId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const current = useRef<DiscussionMessageInput | null>(null);
  const alive = useRef(false);
  useEffect(() => {
    alive.current = true;
    let cancelled = false;
    setReady(false);
    void repository.getDraft(threadId).then(input => {
      if (cancelled) return;
      current.current = input;
      setText(input?.text ?? ''); setReplyId(input?.replyToMessageId ?? null);
      setError(null); setReady(true);
    }, () => { if (!cancelled) setError('Не удалось восстановить черновик'); });
    return () => { cancelled = true; alive.current = false; };
  }, [repository, threadId, reload]);
  const persist = (input: DiscussionMessageInput) => {
    // Invoke now, not from an unmount effect: local transactions are queued before
    // a later send/reopen. Pending local saves may finish after the sheet closes.
    void repository.saveDraft(input).then(() => {
      if (alive.current && current.current === input) setError(null);
    }, reason => {
      if (reason instanceof Error && reason.message === 'DISCUSSION_ID_REUSED') {
        rebase(input.id); return;
      }
      if (alive.current && current.current === input) setError('Не удалось сохранить черновик');
    });
  };
  function rebase(publishedId: string) {
    const latest = current.current;
    // A stale save/send failure must not replace a newer draft or lose later typing.
    if (!latest || latest.id !== publishedId) return;
    const replacement = prepareDiscussionMessage(threadId, latest.text, latest.replyToMessageId);
    current.current = replacement;
    if (alive.current) { setText(replacement.text); setReplyId(replacement.replyToMessageId ?? null); }
    persist(replacement);
  }
  return {
    text, replyId, ready, error,
    update(nextText: string, nextReply: string | null) {
      if (!ready) return;
      const input = { ...(current.current ?? prepareDiscussionMessage(threadId, '')),
        text: nextText, replyToMessageId: nextReply ?? undefined };
      current.current = input; setText(nextText); setReplyId(nextReply); persist(input);
    },
    command(): DiscussionMessageInput {
      if (!current.current) current.current = prepareDiscussionMessage(threadId, text, replyId ?? undefined);
      return { ...current.current, createdAt: new Date().toISOString(), requireUnsentDraft: true };
    },
    rebase,
    sent(id: string) {
      if (current.current?.id !== id) return;
      current.current = null;
      if (alive.current) { setText(''); setReplyId(null); setError(null); }
    },
    retry() {
      if (!ready) setReload(value => value + 1);
      else if (current.current) persist(current.current);
    },
  };
}
