import type { DiscussionAnchor, DiscussionThread } from '../data/cloud/discussion-contracts';
import type { DiscussionMessageInput, DiscussionPage } from '../data/cloud/discussions';
import type { DiscussionCursor, DiscussionMessageView } from '../data/cloud/discussion-views';
import type { DiscussionPort } from '../discussions/discussion-session';

/** In-memory catalogue data. It never opens IndexedDB or contacts Dexie Cloud. */
export const previewDiscussionAnchor: DiscussionAnchor = { kind: 'program', trainingPlanId: 'ui-kit-program' };
export const previewDiscussionThread: DiscussionThread = {
  id: 'ui-kit-thread',
  realmId: 'ui-kit-realm',
  coachClientId: 'ui-kit-pair',
  owner: 'ui-kit-realm',
  anchor: previewDiscussionAnchor,
  anchorKey: '["ui-kit-realm","ui-kit-pair","program","ui-kit-program"]',
  contextPath: [],
  derivedTitleSnapshot: 'Программа «Сила» · 06.11.2026',
  createdAt: '2026-11-06T09:00:00.000Z',
  lastActivityAt: '2026-11-06T09:30:00.000Z',
};

const COACH = 'tg:101';
const CLIENT = 'tg:202';

interface PreviewRow {
  id: string;
  authorUserId: string;
  createdAt: string;
  text: string;
  replyToMessageId?: string;
  deleted?: boolean;
  editedAt?: string;
}

const seed: readonly PreviewRow[] = [
  { id: 'preview-1', authorUserId: COACH, createdAt: '2026-11-06T09:00:00.000Z',
    text: 'Доброе утро! Как прошла тренировка по новой программе?' },
  { id: 'preview-2', authorUserId: CLIENT, createdAt: '2026-11-06T09:04:00.000Z',
    text: 'Доброе утро! На последнем подходе жима было тяжело, но технику сохранил.' },
  { id: 'preview-3', authorUserId: COACH, createdAt: '2026-11-06T09:09:00.000Z',
    text: 'Отлично. На следующей тренировке оставим тот же вес и сосредоточимся на паузе в нижней точке. Если почувствуешь усталость, напиши перед подходом.',
    replyToMessageId: 'preview-2' },
  { id: 'preview-4', authorUserId: CLIENT, createdAt: '2026-11-06T09:12:00.000Z',
    text: 'Понял, спасибо!\nПопробую в понедельник.', replyToMessageId: 'preview-3' },
  { id: 'preview-5', authorUserId: CLIENT, createdAt: '2026-11-06T09:17:00.000Z',
    text: '', deleted: true },
  { id: 'preview-6', authorUserId: COACH, createdAt: '2026-11-06T09:20:00.000Z',
    text: 'Вижу, что сообщение удалено. Если вопрос остался, напиши ещё раз.',
    replyToMessageId: 'preview-5' },
  { id: 'preview-7', authorUserId: CLIENT, createdAt: '2026-11-06T09:30:00.000Z',
    text: 'Хорошо! После следующей тренировки отпишусь.' },
];

function ordered(a: PreviewRow, b: PreviewRow): number {
  return a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);
}

export function createDiscussionPreviewPort(): DiscussionPort {
  const rows = seed.map(row => ({ ...row }));
  const subscribers = new Set<() => void>();
  const drafts = new Map<string, DiscussionMessageInput>();
  const find = (id: string) => rows.find(row => row.id === id);
  const assertThread = (threadId: string) => {
    if (threadId !== previewDiscussionThread.id) throw new Error('PREVIEW_THREAD_NOT_FOUND');
  };
  const view = (row: PreviewRow): DiscussionMessageView => {
    const original = row.replyToMessageId ? find(row.replyToMessageId) : undefined;
    return {
      id: row.id,
      threadId: previewDiscussionThread.id,
      authorUserId: row.authorUserId,
      createdAt: row.createdAt,
      text: row.deleted ? '' : row.text,
      deleted: Boolean(row.deleted),
      editedAt: row.deleted ? undefined : row.editedAt,
      reply: row.deleted || !row.replyToMessageId ? null : {
        messageId: row.replyToMessageId,
        authorUserId: original?.authorUserId ?? null,
        text: original && !original.deleted ? original.text.split(/\r?\n/, 1)[0].slice(0, 160) : '',
        unavailable: !original,
        deleted: Boolean(original?.deleted),
      },
    };
  };
  const slice = (before?: DiscussionCursor, limit = 40): DiscussionPage => {
    const candidates = rows.filter(row => !before || row.createdAt < before.createdAt
      || (row.createdAt === before.createdAt && row.id < before.id)).sort(ordered);
    const selected = candidates.slice(-limit);
    const oldest = selected[0];
    return { messages: selected.map(view),
      before: oldest && candidates.length > selected.length ? { id: oldest.id, createdAt: oldest.createdAt } : null };
  };
  const publish = () => { for (const subscriber of subscribers) subscriber(); };
  const get = (threadId: string, id: string): PreviewRow => {
    assertThread(threadId);
    const row = find(id);
    if (!row) throw new Error('PREVIEW_MESSAGE_NOT_FOUND');
    return row;
  };

  return {
    actorUserId: COACH,
    getDraft: async (threadId, id) => {
      assertThread(threadId);
      const draft = id === undefined
        ? [...drafts.values()].filter(row => row.threadId === threadId).sort(ordered).at(-1)
        : drafts.get(id);
      return draft?.threadId === threadId ? { ...draft } : null;
    },
    saveDraft: async input => {
      assertThread(input.threadId);
      if (find(input.id)) throw new Error('PREVIEW_DRAFT_ALREADY_SENT');
      drafts.set(input.id, { ...input });
    },
    listThreads: async anchor => JSON.stringify(anchor) === JSON.stringify(previewDiscussionAnchor)
      ? [previewDiscussionThread] : [],
    page: async (threadId, before, limit) => { assertThread(threadId); return slice(before, limit); },
    observePage: (threadId, next, error, before, limit) => {
      try { assertThread(threadId); } catch (reason) {
        queueMicrotask(() => error(reason)); return { unsubscribe() {} };
      }
      const emit = () => next(slice(before, limit));
      subscribers.add(emit);
      queueMicrotask(() => { if (subscribers.has(emit)) emit(); });
      return { unsubscribe: () => { subscribers.delete(emit); } };
    },
    getMessage: async (threadId, id) => view(get(threadId, id)),
    send: async (input: DiscussionMessageInput) => {
      assertThread(input.threadId);
      const existing = find(input.id);
      if (existing) return view(existing);
      if (!input.text.trim() || (input.replyToMessageId && !find(input.replyToMessageId)))
        throw new Error('PREVIEW_INVALID_MESSAGE');
      const row: PreviewRow = {
        id: input.id, authorUserId: COACH, createdAt: drafts.has(input.id) ? new Date().toISOString() : input.createdAt, text: input.text,
        replyToMessageId: input.replyToMessageId,
      };
      drafts.delete(input.id); rows.push(row); publish();
      return view(row);
    },
    edit: async (threadId, id, text) => {
      const row = get(threadId, id);
      if (row.authorUserId !== COACH || row.deleted || !text.trim()) throw new Error('PREVIEW_EDIT_FORBIDDEN');
      row.text = text;
      row.editedAt = new Date().toISOString();
      publish();
    },
    remove: async (threadId, id) => {
      const row = get(threadId, id);
      if (row.authorUserId !== COACH || row.deleted) throw new Error('PREVIEW_DELETE_FORBIDDEN');
      row.text = ''; row.deleted = true; publish();
    },
    markRead: async (threadId, id) => { get(threadId, id); },
    sync: {
      observe: next => {
        next({ status: 'local', offline: true, error: null });
        return { unsubscribe() {} };
      },
      retry: async () => {},
    },
  };
}
