import type { CloudContact } from './CloudConnectionsProvider';
import type { MezfitCloudDatabase } from './database';
import { UserProfileRepository } from './user-profile';

/** Enrich authorized contacts only. Presentation failure cannot block the directory or sync. */
export async function resolveContactNames(db: MezfitCloudDatabase, actorUserId: string,
  contacts: readonly CloudContact[]): Promise<CloudContact[]> {
  const repository = new UserProfileRepository(db, actorUserId);
  return Promise.all(contacts.map(async contact => {
    try {
      const result = await repository.readContact(contact.userId, contact.relationshipId);
      if (!result.profile || result.incomplete) return contact;
      const name = [result.profile.firstName, result.profile.lastName].filter(Boolean).join(' ').trim();
      return { ...contact, displayName: name || 'Пользователь Mezfit' };
    } catch {
      return contact;
    }
  }));
}
