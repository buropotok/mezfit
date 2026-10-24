import { Avatar } from '../ui';
import { CloudContactAvatar } from '../contacts/CloudContactAvatar';
import { useCloudConnections } from '../data/cloud/CloudConnectionsProvider';
import type { ProgramActor } from '../program/ProgramSummary';

export function useWorkoutPerson(userId: string | null, realmId: string, actor?: ProgramActor) {
  const cloud = useCloudConnections();
  const self = userId === cloud?.actorUserId;
  const contact = (self ? cloud?.selfAvatars ?? [] : [...(cloud?.clients ?? []), ...(cloud?.coaches ?? [])])
    .find(person => person.userId === userId && person.relationshipId === realmId && (!self || Boolean(person.avatarVersion)));
  const name = self ? actor?.name || 'Вы' : contact?.displayName || 'Атлет';
  const src = self ? actor?.photoUrl ?? undefined : undefined;
  return {
    name,
    avatar: contact ? <CloudContactAvatar contact={contact} /> : <Avatar name={name} src={src} />,
    compactAvatar: contact ? <CloudContactAvatar contact={contact} size="small" />
      : <Avatar name={name} src={src} size="small" />,
  };
}
