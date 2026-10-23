import type { AvatarContactRef } from './contact-avatar-cache';

const keyOf = (contact: AvatarContactRef, variant: 'small' | 'large') =>
  [contact.relationshipId, contact.userId, contact.avatarVersion ?? '',
    contact.avatarMode ?? 'legacy', contact.coachAvatarVersion ?? '',
    contact.coachAvatarMode ?? '', variant].join(':');

/** Provider/account-owned render cache. A cached Blob URL survives calendar page remounts. */
export class ContactAvatarUrls {
  private readonly images = new Map<string, { url?: string; pending?: Promise<string | undefined> }>();

  get(contact: AvatarContactRef, variant: 'small' | 'large' = 'small'): string | undefined {
    return this.images.get(keyOf(contact, variant))?.url;
  }

  async load(contact: AvatarContactRef, loader: () => Promise<Blob | null>, variant: 'small' | 'large' = 'small'): Promise<string | undefined> {
    if (!contact.avatarVersion && !contact.coachAvatarVersion) return undefined;
    const key = keyOf(contact, variant);
    let entry = this.images.get(key);
    if (entry?.url) return entry.url;
    if (entry?.pending) return entry.pending;
    entry = {};
    this.images.set(key, entry);
    const current = entry;
    current.pending = loader().then(blob => {
      // A permission/version change or account disposal invalidates in-flight results.
      if (!blob || this.images.get(key) !== current) return undefined;
      current.url = URL.createObjectURL(blob);
      return current.url;
    }).finally(() => {
      current.pending = undefined;
      if (!current.url && this.images.get(key) === current) this.images.delete(key);
    });
    return current.pending;
  }

  retain(contacts: readonly AvatarContactRef[]): void {
    const allowed = new Set(contacts.flatMap(contact => [keyOf(contact, 'small'), keyOf(contact, 'large')]));
    for (const [key, entry] of this.images) {
      if (allowed.has(key)) continue;
      if (entry.url) URL.revokeObjectURL(entry.url);
      this.images.delete(key);
    }
  }

  dispose(): void { this.retain([]); }
}
