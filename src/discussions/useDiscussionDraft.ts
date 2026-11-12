import { useEffect, useRef, useState } from 'react';
import { prepareDiscussionMessage, type DiscussionMessageInput } from '../data/cloud/discussions';
import { sameDiscussionVideoPosition, type DiscussionVideoPosition } from '../data/cloud/discussion-contracts';
import { discussionMediaTextId, type DiscussionMediaDraft } from '../data/cloud/discussion-media';
import type { DiscussionPort } from './discussion-session';

/** Draft records belong to the repository; this hook owns only composer presentation. */
export function useDiscussionDraft(repository: DiscussionPort, threadId: string) {
  const [text, setText] = useState('');
  const [replyId, setReplyId] = useState<string | null>(null);
  const [videoPosition, setVideoPosition] = useState<DiscussionVideoPosition>();
  const [media, setMedia] = useState<DiscussionMediaDraft>();
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
      setMedia(input?.draftMedia);
      setVideoPosition(input?.replyVideoPosition);
      setText(input?.text ?? ''); setReplyId(input?.replyToMessageId ?? null);
      setError(null); setReady(true);
    }, () => { if (!cancelled) setError('Не удалось восстановить черновик'); });
    return () => { cancelled = true; alive.current = false; };
  }, [repository, threadId, reload]);
  const persist = (input: DiscussionMessageInput) => {
    // Invoke now, not from an unmount effect: local transactions are queued before
    // a later send/reopen. Pending local saves may finish after the sheet closes.
    const { draftMedia: _media, ...caption } = input;
    void repository.saveDraft(caption).then(() => {
      if (alive.current && current.current === input) setError(null);
    }, reason => {
      if (reason instanceof Error && reason.message === 'DISCUSSION_ID_REUSED') {
        if (!input.draftMedia && !current.current?.draftMedia) rebase(input.id);
        return;
      }
      if (alive.current && current.current === input) setError('Не удалось сохранить черновик');
    });
  };
  function rebase(publishedId: string) {
    const latest = current.current;
    // A stale save/send failure must not replace a newer draft or lose later typing.
    if (!latest || latest.id !== publishedId) return;
    const replacement = prepareDiscussionMessage(threadId, latest.text, latest.replyToMessageId, latest.replyVideoPosition);
    current.current = replacement;
    if (alive.current) { setText(replacement.text); setReplyId(replacement.replyToMessageId ?? null); setMedia(undefined); }
    persist(replacement);
  }
  function sent(id: string, restorePrevious = false) {
    if (current.current?.id !== id) return;
    current.current = null;
    if (alive.current) {
      setText(''); setReplyId(null); setVideoPosition(undefined); setError(null); setMedia(undefined);
      if (restorePrevious) { setReady(false); setReload(value => value + 1); }
    }
  }
  return {
    text, replyId, videoPosition, ready, error, media, mediaMessage: media ? current.current : null,
    mediaCommand() {
      return current.current ??= prepareDiscussionMessage(threadId, text, replyId ?? undefined);
    },
    async stageMedia(attachment: DiscussionMediaDraft, separate?: DiscussionMessageInput): Promise<DiscussionMessageInput | null> {
      const input = { ...(separate ?? current.current ?? prepareDiscussionMessage(threadId, text, replyId ?? undefined)),
        draftMedia: attachment };
      try {
        await repository.saveDraft(input);
      } catch (reason) {
        if (!(reason instanceof Error) || reason.message !== 'DISCUSSION_ID_REUSED') throw reason;
        // Dexie can receive the message before its attachment. Keep the draft
        // retryable until both records confirm this exact publication.
        const published = await repository.getMessage(threadId, input.id);
        if (published.deleted || published.authorUserId !== repository.actorUserId
          || !published.attachments?.some(row => row.id === attachment.id && row.storageKey === attachment.storageKey)) throw reason;
        const latest = current.current;
        // Older clients put the text on the attachment message itself.
        const separateText = !published.text && latest?.id === input.id && latest.text.trim()
          ? await repository.getMessage(threadId, discussionMediaTextId(attachment)) : undefined;
        if (separateText && separateText.authorUserId !== repository.actorUserId) throw reason;
        if (latest?.id === input.id && (latest.text.trim() && latest.text !== (separateText?.text ?? published.text)
          || latest.replyToMessageId !== published.reply?.messageId
          || !sameDiscussionVideoPosition(latest.replyVideoPosition, published.reply?.videoPosition))) rebase(input.id);
        else sent(input.id);
        return null;
      }
      if (!separate) {
        current.current = input;
        if (alive.current) setMedia(attachment);
      }
      return { ...input, requireUnsentDraft: true };
    },
    async clearMedia(restorePrevious = false) {
      const input = current.current;
      if (!input?.draftMedia) return;
      if (restorePrevious && !input.text.trim() && !input.replyToMessageId && repository.discardDraft) {
        await repository.discardDraft(threadId, input.id);
        sent(input.id, true);
        return;
      }
      if (!repository.updateDraftMedia) return;
      await repository.updateDraftMedia(threadId, input.id, input.draftMedia.storageKey, 'clear');
      if (current.current?.id === input.id) delete current.current.draftMedia;
      if (alive.current) setMedia(undefined);
    },
    update(nextText: string, nextReply: string | null, nextPosition?: DiscussionVideoPosition) {
      if (!ready) return;
      const { replyVideoPosition: _position, ...previous } = current.current ?? prepareDiscussionMessage(threadId, '');
      const input = { ...previous, text: nextText, replyToMessageId: nextReply ?? undefined,
        ...(nextPosition ? { replyVideoPosition: nextPosition } : {}) };
      current.current = input;
      setText(nextText); setReplyId(nextReply); setVideoPosition(nextPosition);
      persist(input);
    },
    command(): DiscussionMessageInput {
      if (!current.current) current.current = prepareDiscussionMessage(threadId, text, replyId ?? undefined);
      return { ...current.current, createdAt: new Date().toISOString(), requireUnsentDraft: true };
    },
    rebase,
    sent,
    retry() {
      if (!ready) setReload(value => value + 1);
      else if (current.current) persist(current.current);
    },
  };
}
