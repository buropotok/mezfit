import type { UserAvatarSnapshot } from './user-avatar';

interface UserAvatarObserver {
  observe(userId: string, realmId: string, next: (snapshot: UserAvatarSnapshot) => void,
    error: (reason: unknown) => void): { unsubscribe: () => void };
}

export interface UserAvatarSource {
  status: 'pending' | 'ready' | 'error';
  custom: boolean;
  small?: string;
  large?: string;
}
const PENDING: UserAvatarSource = { status: 'pending', custom: false };
const ERROR: UserAvatarSource = { status: 'error', custom: false };
const keyOf = (userId: string, realmId: string) => JSON.stringify([userId, realmId]);
interface Entry {
  userId: string;
  realmId: string;
  snapshot: UserAvatarSource;
  value?: UserAvatarSnapshot;
  listeners: Set<() => void>;
  variants: Set<'small' | 'large'>;
  unsubscribe?: () => void;
  token?: object;
}

/** Account-owned render state only. Dexie remains the sole persistent image store.
 * Keep observed sources across screen unmounts so the next render has the same URL.
 */
export class UserAvatarSources {
  private readonly entries = new Map<string, Entry>();
  private allowed: Set<string> | null = null;
  constructor(private readonly repository: UserAvatarObserver, private readonly actorUserId: string) {}

  get(userId: string, realmId: string): UserAvatarSource {
    return this.entries.get(keyOf(userId, realmId))?.snapshot ?? PENDING;
  }

  subscribe(userId: string, realmId: string, listener: () => void, variant: 'small' | 'large' = 'small'): () => void {
    const key = keyOf(userId, realmId);
    let entry = this.entries.get(key);
    if (!entry) {
      entry = { userId, realmId, snapshot: PENDING, listeners: new Set(), variants: new Set() };
      this.entries.set(key, entry);
    }
    entry.listeners.add(listener);
    entry.variants.add(variant);
    if (entry.value && entry.snapshot.custom && !entry.snapshot[variant]) {
      try { this.update(entry, entry.value); }
      catch { this.release(entry); this.emit(entry, ERROR); }
    }
    if ((!entry.unsubscribe || entry.snapshot.status === 'error') && (!this.allowed || this.allowed.has(key))) this.start(entry);
    const current = entry;
    return () => { current.listeners.delete(listener); };
  }

  private emit(entry: Entry, snapshot: UserAvatarSource) {
    entry.snapshot = snapshot;
    for (const listener of entry.listeners) listener();
  }

  private release(entry: Entry) {
    if (entry.snapshot.small) URL.revokeObjectURL(entry.snapshot.small);
    if (entry.snapshot.large) URL.revokeObjectURL(entry.snapshot.large);
    entry.value = undefined;
  }

  private update(entry: Entry, data: UserAvatarSnapshot) {
    if (!data.incomplete && data.value?.small instanceof Blob && data.value.large instanceof Blob) {
      const next: UserAvatarSource = { status: 'ready', custom: true };
      const created: string[] = [];
      try {
        for (const variant of entry.variants) {
          const previous = entry.snapshot[variant];
          if (previous && entry.value?.value?.[variant] === data.value[variant]) next[variant] = previous;
          else {
            const image = variant === 'small' ? data.value.small : data.value.large;
            if (!(image instanceof Blob)) throw new Error('AVATAR_NOT_HYDRATED');
            const url = URL.createObjectURL(image);
            next[variant] = url; created.push(url);
          }
        }
      } catch (reason) { for (const url of created) URL.revokeObjectURL(url); throw reason; }
      for (const variant of ['small', 'large'] as const) {
        const previous = entry.snapshot[variant];
        if (previous && previous !== next[variant]) URL.revokeObjectURL(previous);
      }
      entry.value = data;
      if (entry.snapshot.status !== next.status || entry.snapshot.custom !== next.custom
        || entry.snapshot.small !== next.small || entry.snapshot.large !== next.large) this.emit(entry, next);
      return;
    }
    this.release(entry);
    entry.value = data;
    this.emit(entry, data.incomplete ? PENDING : { status: 'ready', custom: false });
  }

  private start(entry: Entry) {
    entry.token = undefined;
    entry.unsubscribe?.();
    entry.unsubscribe = undefined;
    const token = {};
    entry.token = token;
    const fail = () => {
      if (entry.token !== token) return;
      entry.token = undefined;
      entry.unsubscribe?.(); entry.unsubscribe = undefined;
      this.release(entry);
      this.emit(entry, ERROR);
    };
    try {
      const subscription = this.repository.observe(entry.userId, entry.realmId,
        data => { if (entry.token === token) { try { this.update(entry, data); } catch { fail(); } } }, fail);
      if (entry.token === token) entry.unsubscribe = () => subscription.unsubscribe();
      else subscription.unsubscribe();
    } catch { fail(); }
  }

  /** Retry only on the existing Addon hydration signal or an explicit refresh. */
  refresh() {
    for (const [key, entry] of this.entries) if (!this.allowed || this.allowed.has(key)) this.start(entry);
  }

  retain(contacts: readonly { userId: string; relationshipId: string }[]) {
    this.allowed = new Set([keyOf(this.actorUserId, this.actorUserId), ...contacts.map(contact =>
      keyOf(contact.userId, contact.userId === this.actorUserId ? this.actorUserId : contact.relationshipId))]);
    for (const [key, entry] of this.entries) {
      if (this.allowed.has(key)) {
        if (!entry.unsubscribe || entry.snapshot.status === 'error') this.start(entry);
      } else {
        entry.token = undefined;
        entry.unsubscribe?.(); entry.unsubscribe = undefined;
        this.release(entry);
        this.emit(entry, ERROR);
      }
    }
  }

  dispose() {
    for (const entry of this.entries.values()) {
      entry.token = undefined;
      entry.unsubscribe?.();
      this.release(entry);
    }
    this.entries.clear();
  }
}
