import Dexie from 'dexie';
import { discussionId, discussionRecord } from '../../../shared/discussion-anchor';
import type { MezfitCloudDatabase } from './database';
import { assertDiscussionThread, matchesDiscussionReadStateId, type DiscussionThread } from './discussion-contracts';
import { discussionCursorFromKey, discussionCursorKey, isDiscussionMessage } from './discussion-views';

/** Only counts/configuration leave this adapter; never rows, identifiers or text. */
export interface DiscussionReadDiagnosticReport {
  version: 1;
  tablesAvailable: boolean;
  readStatesSynced: boolean | null;
  threads: number;
  invalidThreads: number;
  ownStates: number;
  peerStates: number;
  acceptedOwnStates: number;
  acceptedPeerStates: number;
  rejected: {
    identity: number;
    owner: number;
    threadOrRealm: number;
    missingCursor: number;
    invalidCursor: number;
    cursorMessageMismatch: number;
  };
  outgoing: number;
  outgoingWithPeerState: number;
  outgoingRead: number;
  incoming: number;
  incomingReadLocally: number;
  invalidMessages: number;
}

const actorId = (value: unknown): value is string => typeof value === 'string' && /^tg:[1-9]\d*$/.test(value);
const scopeKey = (realm: string, thread: string) => JSON.stringify([realm, thread]);

/** Mirrors receipt acceptance checks; an absent/rejected state is never proof of reading. */
export function summarizeDiscussionReads(actor: string, threads: readonly DiscussionThread[],
  messages: readonly unknown[], states: readonly unknown[], readStatesSynced: boolean | null): DiscussionReadDiagnosticReport {
  const report: DiscussionReadDiagnosticReport = {
    version: 1, tablesAvailable: true, readStatesSynced, threads: threads.length, invalidThreads: 0,
    ownStates: 0, peerStates: 0, acceptedOwnStates: 0, acceptedPeerStates: 0,
    rejected: { identity: 0, owner: 0, threadOrRealm: 0, missingCursor: 0, invalidCursor: 0, cursorMessageMismatch: 0 },
    outgoing: 0, outgoingWithPeerState: 0, outgoingRead: 0,
    incoming: 0, incomingReadLocally: 0, invalidMessages: 0,
  };
  const scopes = new Set<string>();
  for (const thread of threads) {
    try {
      assertDiscussionThread(thread);
      scopes.add(scopeKey(thread.realmId, thread.id));
    } catch { report.invalidThreads++; }
  }
  const own = new Map<string, string>();
  const peer = new Map<string, string>();
  for (const state of states) {
    if (!discussionRecord(state) || !actorId(state.userId) || !discussionId(state.realmId)
      || !discussionId(state.threadId)) { report.rejected.identity++; continue; }
    if (state.userId === actor) report.ownStates++; else report.peerStates++;
    if (!matchesDiscussionReadStateId(state.id, state.realmId, state.threadId, state.userId)) {
      report.rejected.identity++; continue;
    }
    if (state.owner !== state.userId) { report.rejected.owner++; continue; }
    const key = scopeKey(state.realmId, state.threadId);
    if (!scopes.has(key)) { report.rejected.threadOrRealm++; continue; }
    if (state.readThrough === undefined || state.readThrough === '') { report.rejected.missingCursor++; continue; }
    const cursor = discussionCursorFromKey(state.readThrough);
    if (!cursor) { report.rejected.invalidCursor++; continue; }
    if (cursor.id !== state.lastReadMessageId) { report.rejected.cursorMessageMismatch++; continue; }
    const target = state.userId === actor ? own : peer;
    if (state.userId === actor) report.acceptedOwnStates++; else report.acceptedPeerStates++;
    const watermark = discussionCursorKey(cursor);
    if ((target.get(key) ?? '') < watermark) target.set(key, watermark);
  }
  for (const message of messages) {
    if (!isDiscussionMessage(message)) { report.invalidMessages++; continue; }
    if (message.draftForRealmId || message.deletedAt) continue;
    const key = scopeKey(message.realmId, message.threadId);
    if (!scopes.has(key)) { report.invalidMessages++; continue; }
    const cursor = discussionCursorKey(message);
    if (message.authorUserId === actor) {
      report.outgoing++;
      if (peer.has(key)) report.outgoingWithPeerState++;
      if ((peer.get(key) ?? '') >= cursor) report.outgoingRead++;
    } else {
      report.incoming++;
      if ((own.get(key) ?? '') >= cursor) report.incomingReadLocally++;
    }
  }
  return report;
}

/** On-demand, read-only, consistent local snapshot; Addon remains the only transport. */
export function readDiscussionDiagnostics(db: MezfitCloudDatabase, actor: string): Promise<DiscussionReadDiagnosticReport> {
  const available = ['discussionThreads', 'discussionMessages', 'discussionReadStates']
    .every(name => db.tables.some(table => table.name === name));
  const synced = db.cloud.schema?.discussionReadStates?.markedForSync ?? null;
  if (!available) return Promise.resolve({ ...summarizeDiscussionReads(actor, [], [], [], synced), tablesAvailable: false });
  return db.transaction('r', [db.discussionThreads, db.discussionMessages, db.discussionReadStates], () =>
    Dexie.Promise.all([
      db.discussionThreads.toArray(), db.discussionMessages.toArray(), db.discussionReadStates.toArray(),
    ]).then(([threads, messages, states]) => summarizeDiscussionReads(actor, threads, messages, states, synced)));
}
