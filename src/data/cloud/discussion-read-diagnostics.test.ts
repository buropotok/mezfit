import { describe, expect, it } from 'vitest';
import { discussionAnchorKey } from '../../../shared/discussion-anchor';
import { discussionReadStateId, type DiscussionMessage, type DiscussionReadState, type DiscussionThread } from './discussion-contracts';
import { summarizeDiscussionReads } from './discussion-read-diagnostics';
import { discussionCursorKey } from './discussion-views';

const actor = 'tg:11';
const recipient = 'tg:22';
const instant = '2026-11-07T09:00:00.000Z';
function thread(id = 'legacy-thread', realmId = 'shared-realm'): DiscussionThread {
  const scope = { realmId, coachClientId: realmId };
  const anchor = { kind: 'program' as const, trainingPlanId: 'private-program-id' };
  return { ...scope, id, owner: realmId, anchor, anchorKey: discussionAnchorKey(scope, anchor),
    contextPath: [], derivedTitleSnapshot: 'Private program name', createdAt: instant, lastActivityAt: instant };
}
function message(authorUserId = actor, id = 'message-secret'): DiscussionMessage {
  return { id, realmId: 'shared-realm', threadId: 'legacy-thread', owner: authorUserId,
    authorUserId, text: 'Never expose this private text', createdAt: instant };
}
function state(userId = recipient, source = message()): DiscussionReadState {
  return { id: discussionReadStateId(source.realmId, source.threadId, userId), realmId: source.realmId,
    threadId: source.threadId, userId, owner: userId, lastReadMessageId: source.id,
    readThrough: discussionCursorKey(source), lastReadAt: instant };
}

describe('read receipt evidence report', () => {
  it('distinguishes local reading from a missing replicated recipient state', () => {
    const incoming = message(recipient);
    const report = summarizeDiscussionReads(actor, [thread()], [incoming], [state(actor, incoming)], true);
    expect(report.incomingReadLocally).toBe(1);
    expect(report.acceptedOwnStates).toBe(1);
    expect(report.peerStates).toBe(0);
    expect(report.outgoingRead).toBe(0);
  });

  it.each([[actor, recipient], [recipient, actor]])('reports valid counterpart evidence for sender %s', (sender, peer) => {
    const outgoing = message(sender);
    const report = summarizeDiscussionReads(sender, [thread()], [outgoing], [state(peer, outgoing)], true);
    expect(report.acceptedPeerStates).toBe(1);
    expect(report.outgoingWithPeerState).toBe(1);
    expect(report.outgoingRead).toBe(1);
  });

  it('does not treat a reply or own watermark as recipient reading evidence', () => {
    const outgoing = message();
    const reply = { ...message(recipient, 'reply-secret'), createdAt: '2026-11-07T09:01:00.000Z' };
    const report = summarizeDiscussionReads(actor, [thread()], [outgoing, reply], [state(actor, reply)], true);
    expect(report.incomingReadLocally).toBe(1);
    expect(report.outgoingRead).toBe(0);
  });

  it('separates each rejected-state reason without returning raw records', () => {
    const source = state();
    const wrongThread = { ...source, threadId: 'other-thread', id: discussionReadStateId(source.realmId, 'other-thread', recipient) };
    const report = summarizeDiscussionReads(actor, [thread()], [message()], [
      null, { ...source, id: 'wrong-id' }, { ...source, owner: actor }, wrongThread,
      { ...source, readThrough: undefined }, { ...source, readThrough: 'not-a-cursor' },
      { ...source, lastReadMessageId: 'wrong-message' },
    ], true);
    expect(report.rejected).toEqual({ identity: 2, owner: 1, threadOrRealm: 1,
      missingCursor: 1, invalidCursor: 1, cursorMessageMismatch: 1 });
    expect(report.outgoingRead).toBe(0);
    const serialized = JSON.stringify(report);
    for (const privateValue of [actor, recipient, source.realmId, source.id, message().text, thread().derivedTitleSnapshot]) {
      expect(serialized).not.toContain(privateValue);
    }
  });

  it('keeps watermarks in their original storage thread and realm, including legacy threads', () => {
    const outgoing = message();
    const otherThread = { ...outgoing, threadId: 'entity-discussion:canonical', id: 'other-message' };
    const otherRealm = { ...outgoing, realmId: 'other-realm', id: 'third-message' };
    const report = summarizeDiscussionReads(actor,
      [thread(), thread(otherThread.threadId), thread(otherRealm.threadId, otherRealm.realmId)],
      [outgoing, otherThread, otherRealm], [state(recipient, outgoing)], true);
    expect(report.outgoing).toBe(3);
    expect(report.outgoingWithPeerState).toBe(1);
    expect(report.outgoingRead).toBe(1);
  });

  it('distinguishes an earlier peer watermark from an unread later message', () => {
    const later = { ...message(), createdAt: '2026-11-07T09:02:00.000Z' };
    const report = summarizeDiscussionReads(actor, [thread()], [later], [state()], null);
    expect(report.readStatesSynced).toBeNull();
    expect(report.outgoingWithPeerState).toBe(1);
    expect(report.outgoingRead).toBe(0);
  });

  it('excludes private drafts and deleted messages and counts malformed records safely', () => {
    const report = summarizeDiscussionReads(actor, [thread()], [null,
      { ...message(), draftForRealmId: 'shared-realm' }, { ...message(), deletedAt: instant }], [], false);
    expect(report.invalidMessages).toBe(1);
    expect(report.outgoing).toBe(0);
    expect(report.readStatesSynced).toBe(false);
  });
});
