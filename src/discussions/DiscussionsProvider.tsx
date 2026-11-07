import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { liveQuery } from 'dexie';
import { useCloudConnections, type CloudContact } from '../data/cloud/CloudConnectionsProvider';
import { DiscussionRepository, type DiscussionFeedRow } from '../data/cloud/discussions';
import { sortDiscussionFeed } from './feed-presentation';

export interface DiscussionInboxRow extends DiscussionFeedRow { contact: CloudContact | null }
interface Inbox { rows: DiscussionInboxRow[]; unread: number; loading: boolean; error: string; retry: () => void }
const Context = createContext<Inbox>({ rows: [], unread: 0, loading: true, error: '', retry: () => {} });
/** One role-scoped local observer shared by the tab badge and both inbox surfaces. */
export function DiscussionsProvider({ role, details = true, children }: { role: 'coach' | 'client'; details?: boolean; children: ReactNode }) {
  const cloud = useCloudConnections();
  const contacts = role === 'coach' ? cloud?.clients : cloud?.coaches;
  const [revision, setRevision] = useState(0);
  const identity = useMemo(() => ({}), [cloud?.db, cloud?.actorUserId, role, contacts, revision, details]);
  const [snapshot, setSnapshot] = useState<{ identity: object; rows: DiscussionInboxRow[]; error: string } | null>(null);
  useEffect(() => {
    if (!cloud) return;
    let active = true;
    const peers = [...new Map((contacts ?? []).map(contact => [contact.relationshipId, contact])).values()];
    const sub = liveQuery(async () => {
      const scopes = [{ realmId: cloud.actorUserId, coachClientId: null, contact: null as CloudContact | null },
        ...peers.map(contact => ({ realmId: contact.relationshipId, coachClientId: contact.relationshipId, contact }))];
      const rows: DiscussionInboxRow[] = [];
      // Serialize membership validation; each repository owns its local read transaction.
      for (const scope of scopes) {
        const repository = new DiscussionRepository(cloud.db, cloud.actorUserId, scope);
        try {
          for (const row of await repository.feed(details ? cloud.db : undefined, details)) rows.push({ ...row, contact: scope.contact });
        } catch (reason) {
          // Membership can be revoked before the contact projection updates.
          if (!(reason instanceof Error) || reason.message !== 'DISCUSSION_ACCESS_DENIED') throw reason;
        }
      }
      return sortDiscussionFeed(rows);
    }).subscribe({ next: rows => { if (active) setSnapshot({ identity, rows, error: '' }); },
      error: () => { if (active) setSnapshot({ identity, rows: [], error: 'Не удалось прочитать обсуждения' }); } });
    return () => { active = false; sub.unsubscribe(); };
  }, [identity]);
  const current = snapshot?.identity === identity ? snapshot : null;
  const rows = current?.rows ?? [];
  const value: Inbox = { rows, unread: rows.reduce((sum, row) => sum + row.unread, 0),
    loading: Boolean(cloud) && (!current || cloud?.status === 'loading'), error: !cloud ? 'Обсуждения недоступны' : current?.error ?? '', retry: () => setRevision(value => value + 1) };
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export const useDiscussions = () => useContext(Context);
