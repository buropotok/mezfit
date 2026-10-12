import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { liveQuery } from 'dexie';
import { isApprovedAssignedPair } from './assigned-programs';
import { createCloudDatabase, type MezfitCloudDatabase } from './database';

/** Telegram's verified identity, not the former D1 integer, is the contact ID. */
export interface CloudContact {
  relationshipId: string;
  userId: string;
  telegramUserId: string;
  displayName: string;
}

interface CloudConnectionsValue {
  db: MezfitCloudDatabase;
  actorUserId: string;
  clients: CloudContact[];
  coaches: CloudContact[];
  status: 'loading' | 'ready' | 'error';
  error: string;
  refresh: () => Promise<void>;
}

const Context = createContext<CloudConnectionsValue | null>(null);

function contact(realmId: string, member: { userId?: string; name?: string }, fallback: string): CloudContact | null {
  const userId = member.userId;
  if (!userId || !/^tg:[1-9]\d*$/.test(userId)) return null;
  return {
    relationshipId: realmId,
    userId,
    telegramUserId: userId.slice(3),
    displayName: member.name?.trim() || fallback,
  };
}

type RealmView = { realmId: string; name?: string; owner?: unknown };
type MemberView = {
  id: string;
  realmId: string;
  userId?: string;
  name?: string;
  roles?: string[];
  owner?: unknown;
  accepted?: Date;
  invite?: boolean;
  permissions?: unknown;
};

/** Derived presentation only: server-enforced memberships remain the access boundary. */
export async function deriveCloudContacts(
  actorUserId: string,
  realms: readonly RealmView[],
  members: readonly MemberView[],
): Promise<{ clients: CloudContact[]; coaches: CloudContact[] }> {
  const realmById = new Map(realms.map((realm) => [realm.realmId, realm]));
  const own = members.filter((member) => member.userId === actorUserId);
  const links = await Promise.all(own.map(async (mine) => {
    const partner = members.find((member) => member.realmId === mine.realmId
      && member.userId !== actorUserId);
    if (!partner?.userId) return null;
    const asCoach = mine.roles?.includes('coach') === true && partner.roles?.includes('client') === true;
    const asClient = mine.roles?.includes('client') === true && partner.roles?.includes('coach') === true;
    if (!asCoach && !asClient) return null;
    const coachUserId = asCoach ? actorUserId : partner.userId;
    const clientUserId = asCoach ? partner.userId : actorUserId;
    if (!await isApprovedAssignedPair(realmById.get(mine.realmId), members, coachUserId, clientUserId)) {
      return null;
    }
    const peer = contact(mine.realmId, partner, asCoach ? 'Клиент Mezfit' : 'Тренер Mezfit');
    return peer ? { peer, asCoach } : null;
  }));
  const connections = links.filter((link): link is { peer: CloudContact; asCoach: boolean } => link !== null);
  return {
    clients: connections.filter((link) => link.asCoach).map((link) => link.peer),
    coaches: connections.filter((link) => !link.asCoach).map((link) => link.peer),
  };
}

export function CloudConnectionsProvider({
  telegramUserId, initData, children,
}: { telegramUserId: string; initData: string; children: ReactNode }) {
  const db = useMemo(() => createCloudDatabase(telegramUserId, initData), [telegramUserId, initData]);
  const actorUserId = `tg:${telegramUserId}`;
  const [clients, setClients] = useState<CloudContact[]>([]);
  const [coaches, setCoaches] = useState<CloudContact[]>([]);
  const [status, setStatus] = useState<CloudConnectionsValue['status']>('loading');
  const [error, setError] = useState('');
  const alive = useRef(false);

  useEffect(() => {
    alive.current = true;
    let active = true;
    const subscription = liveQuery(async () => {
      const [realms, members] = await Promise.all([db.realms.toArray(), db.members.toArray()]);
      return deriveCloudContacts(actorUserId, realms, members);
    }).subscribe({
      next: (next) => {
        if (!active) return;
        setClients(next.clients);
        setCoaches(next.coaches);
        setError('');
        setStatus('ready');
      },
      error: (reason: unknown) => {
        if (!active) return;
        setStatus('error');
        setError(reason instanceof Error ? reason.message : 'Не удалось открыть список связей');
      },
    });
    return () => {
      active = false;
      alive.current = false;
      subscription.unsubscribe();
      // React StrictMode re-runs effects with the same memoized db instance.
      // Preserve Dexie 4 auto-open so the next liveQuery can reopen it.
      db.close({ disableAutoOpen: false });
    };
  }, [db, actorUserId]);

  const refresh = useCallback(async () => {
    try {
      await db.cloud.sync({ purpose: 'pull', wait: true });
      const [realms, members] = await Promise.all([db.realms.toArray(), db.members.toArray()]);
      const next = await deriveCloudContacts(actorUserId, realms, members);
      if (!alive.current) return;
      setClients(next.clients);
      setCoaches(next.coaches);
      setError('');
      setStatus('ready');
    } catch (reason) {
      if (alive.current) {
        setStatus('error');
        setError(reason instanceof Error ? reason.message : 'Не удалось синхронизировать связи');
      }
      throw reason;
    }
  }, [db, actorUserId]);

  const value = useMemo<CloudConnectionsValue>(() => ({
    db, actorUserId, clients, coaches, status, error, refresh,
  }), [db, actorUserId, clients, coaches, status, error, refresh]);

  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useCloudConnections(): CloudConnectionsValue | null {
  return useContext(Context);
}
