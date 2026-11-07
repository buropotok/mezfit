import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useCloudConnections, type CloudContact } from '../data/cloud/CloudConnectionsProvider';
import type { DiscussionFeedRow } from '../data/cloud/discussions';
import { observeDiscussionFeed } from '../data/cloud/discussion-feed';
import { sortDiscussionFeed } from './feed-presentation';

export interface DiscussionInboxRow extends DiscussionFeedRow { contact: CloudContact | null }
interface Inbox { rows: DiscussionInboxRow[]; unread: number; loading: boolean; error: string; retry: () => void }
const Context = createContext<Inbox>({ rows: [], unread: 0, loading: true, error: '', retry: () => {} });
/** One role-scoped local observer shared by the tab badge and both inbox surfaces. */
export function DiscussionsProvider({ role, details = true, children }: { role: 'coach' | 'client'; details?: boolean; children: ReactNode }) {
  const cloud = useCloudConnections();
  const contacts = role === 'coach' ? cloud?.clients : cloud?.coaches;
  const [revision, setRevision] = useState(0);
  const realmKey = JSON.stringify([...new Set((contacts ?? []).map(contact => contact.relationshipId))].sort());
  const realmIds = useMemo<string[]>(() => JSON.parse(realmKey), [realmKey]);
  const identity = useMemo(() => ({}), [cloud?.db, cloud?.actorUserId, role, realmIds, revision, details]);
  const [snapshot, setSnapshot] = useState<{ identity: object; rows: DiscussionFeedRow[]; error: string } | null>(null);
  useEffect(() => {
    if (!cloud) return;
    let active = true;
    const scopes = [{ realmId: cloud.actorUserId, coachClientId: null },
      ...realmIds.map(realmId => ({ realmId, coachClientId: realmId }))];
    const sub = observeDiscussionFeed(cloud.db, cloud.actorUserId, scopes, details, rows => {
      if (active) setSnapshot({ identity, rows: sortDiscussionFeed(rows), error: '' });
    }, () => { if (active) setSnapshot({ identity, rows: [], error: 'Не удалось прочитать обсуждения' }); });
    return () => { active = false; sub.unsubscribe(); };
  }, [identity]);
  const current = snapshot?.identity === identity ? snapshot : null;
  const rows: DiscussionInboxRow[] = (current?.rows ?? []).map(row => ({ ...row,
    contact: contacts?.find(contact => contact.relationshipId === row.thread.realmId) ?? null }));
  const value: Inbox = { rows, unread: rows.reduce((sum, row) => sum + row.unread, 0),
    loading: Boolean(cloud) && (!current || cloud?.status === 'loading'), error: !cloud ? 'Обсуждения недоступны' : current?.error ?? '', retry: () => setRevision(value => value + 1) };
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export const useDiscussions = () => useContext(Context);
