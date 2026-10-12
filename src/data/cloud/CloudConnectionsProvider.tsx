import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { liveQuery } from 'dexie';
import { isApprovedAssignedPair } from './assigned-programs';
import { createCloudDatabase, type MezfitCloudDatabase } from './database';
import { syncCloudContactProfile } from '../../api';
import { loadContactAvatar } from './contact-avatar-cache';

/** Telegram's verified identity, not the former D1 integer, is the contact ID. */
export interface CloudContact {
  relationshipId: string;
  userId: string;
  telegramUserId: string;
  displayName: string;
  avatarVersion?: string | null;
}

interface CloudConnectionsValue {
  db: MezfitCloudDatabase;
  actorUserId: string;
  clients: CloudContact[];
  coaches: CloudContact[];
  status: 'loading' | 'ready' | 'error';
  error: string;
  refresh: () => Promise<void>;
  loadAvatar: (contact: CloudContact) => Promise<Blob | null>;
}

const Context = createContext<CloudConnectionsValue | null>(null);

function contact(realmId: string, member: { userId?: string; name?: string; avatarVersion?: string | null }, fallback: string): CloudContact | null {
  const userId = member.userId;
  if (!userId || !/^tg:[1-9]\d*$/.test(userId)) return null;
  return {
    relationshipId: realmId,
    userId,
    telegramUserId: userId.slice(3),
    displayName: member.name?.trim() || fallback,
    avatarVersion: typeof member.avatarVersion === 'string' && /^[a-f0-9]{64}$/.test(member.avatarVersion)
      ? member.avatarVersion : null,
  };
}

type RealmView = { realmId: string; name?: string; owner?: unknown };
type MemberView = {
  id: string;
  realmId: string;
  userId?: string;
  name?: string;
  avatarVersion?: string | null;
  roles?: string[];
  owner?: unknown;
  // Raw synced memberships can expose the Worker's accepted:true marker.
  accepted?: Date | boolean;
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

/** One local snapshot; access control still belongs to Dexie Cloud server. */
async function readContactSnapshot(db: MezfitCloudDatabase, actorUserId: string) {
  const [realms, members] = await Promise.all([db.realms.toArray(), db.members.toArray()]);
  return {
    contacts: await deriveCloudContacts(actorUserId, realms, members),
    hasRelationshipMembership: members.some((member) => member.userId === actorUserId
      && (member.roles?.includes('coach') || member.roles?.includes('client'))),
  };
}

function hasRejectedContacts(snapshot: Awaited<ReturnType<typeof readContactSnapshot>>): boolean {
  return snapshot.hasRelationshipMembership
    && snapshot.contacts.clients.length === 0 && snapshot.contacts.coaches.length === 0;
}

const INVALID_CONTACTS_MESSAGE = 'Облачная связь найдена, но не прошла проверку. Повторите синхронизацию.';

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
  const initialPullSucceededRef = useRef(false);

  useEffect(() => {
    alive.current = true;
    let active = true;
    initialPullSucceededRef.current = false;
    let locallyAvailable = false;

    const publish = (next: { clients: CloudContact[]; coaches: CloudContact[] }) => {
      if (!active) return;
      const hasContacts = next.clients.length > 0 || next.coaches.length > 0;
      locallyAvailable = hasContacts;
      // An empty IndexedDB is not evidence that the cloud has no relationships.
      if (!initialPullSucceededRef.current && !hasContacts) return;
      setClients(next.clients);
      setCoaches(next.coaches);
      setError('');
      setStatus('ready');
    };

    const readContacts = () => readContactSnapshot(db, actorUserId);

    const subscription = liveQuery(readContacts).subscribe({
      next: ({ contacts, hasRelationshipMembership }) => {
        if (!active) return;
        if (initialPullSucceededRef.current && hasRejectedContacts({ contacts, hasRelationshipMembership })) {
          setError(INVALID_CONTACTS_MESSAGE);
          setStatus('error');
          return;
        }
        publish(contacts);
      },
      error: (reason: unknown) => {
        if (!active) return;
        setStatus('error');
        setError(reason instanceof Error ? reason.message : 'Не удалось открыть список связей');
      },
    });

    // The addon normally syncs eagerly, but the first local read can be empty.
    // Explicit pull gives us a confirmed initial hydration or a real error.
    void (async () => {
      try {
        // Await a real Dexie table read: this opens the database (and starts the
        // cloud sync worker) before sending the first pull signal.
        await db.realms.toArray();
        if (!active) return;
        await db.cloud.sync({ purpose: 'pull', wait: true });
        if (!active) return;
        const { contacts, hasRelationshipMembership } = await readContacts();
        if (!active) return;
        initialPullSucceededRef.current = true;
        if (hasRejectedContacts({ contacts, hasRelationshipMembership })) {
          setError(INVALID_CONTACTS_MESSAGE);
          setStatus('error');
        } else {
          publish(contacts);
        }
      } catch {
        if (!active) return;
        // A failed pull cannot authorize an empty-state claim on later local updates.
        // Previously synced contacts must stay usable without connectivity.
        if (!locallyAvailable && !initialPullSucceededRef.current) {
          setStatus('error');
          setError('Не удалось синхронизировать связи с Dexie Cloud. Проверьте соединение и повторите.');
        }
      }
    })();

    return () => {
      active = false;
      alive.current = false;
      subscription.unsubscribe();
      // React StrictMode re-runs effects with the same memoized db instance.
      // Preserve Dexie 4 auto-open so the next liveQuery can reopen it.
      db.close({ disableAutoOpen: false });
    };
  }, [db, actorUserId]);

  // Profile writes are privileged and change-only; failures must not block offline lists.
  useEffect(() => {
    let active = true;
    void syncCloudContactProfile(initData)
      .then((changed) => {
        if (active && changed) void db.cloud.sync({ purpose: 'pull', wait: false }).catch(() => {});
      })
      .catch(() => {});
    return () => { active = false; };
  }, [db, initData]);

  const loadAvatar = useCallback((peer: CloudContact) =>
    loadContactAvatar(telegramUserId, initData, peer), [telegramUserId, initData]);

  const refresh = useCallback(async () => {
    try {
      await db.cloud.sync({ purpose: 'pull', wait: true });
      const snapshot = await readContactSnapshot(db, actorUserId);
      if (!alive.current) return;
      if (hasRejectedContacts(snapshot)) throw new Error(INVALID_CONTACTS_MESSAGE);
      initialPullSucceededRef.current = true;
      setClients(snapshot.contacts.clients);
      setCoaches(snapshot.contacts.coaches);
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
    db, actorUserId, clients, coaches, status, error, refresh, loadAvatar,
  }), [db, actorUserId, clients, coaches, status, error, refresh, loadAvatar]);

  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useCloudConnections(): CloudConnectionsValue | null {
  return useContext(Context);
}
