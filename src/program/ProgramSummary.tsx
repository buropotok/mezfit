import type { CloudTrainingPlanRow } from '../data/cloud/database';
import { useCloudConnections } from '../data/cloud/CloudConnectionsProvider';
import { planAuthorUserId } from '../data/cloud/program-ownership';
import { athleteOf } from '../data/cloud/program-management';
import { CloudContactAvatar } from '../contacts/CloudContactAvatar';
import { Avatar, GlassSurface, Text } from '../ui';

export interface ProgramActor { name: string; photoUrl?: string | null }

export function ProgramSummary({ program, phaseCount, actorUserId, actor, showName = false }: {
  program: CloudTrainingPlanRow;
  phaseCount: number;
  actorUserId: string;
  actor?: ProgramActor;
  showName?: boolean;
}) {
  const cloud = useCloudConnections();
  const people = [...(cloud?.clients ?? []), ...(cloud?.coaches ?? [])];
  const resolve = (id: string | null, fallback: string) => {
    if (id === actorUserId) return { name: actor?.name || 'Вы', self: true, contact: undefined };
    const contact = people.find((person) => person.userId === id && person.relationshipId === program.realmId);
    return { name: contact?.displayName || fallback, self: false, contact };
  };
  const owner = resolve(planAuthorUserId(program), 'Автор программы');
  const athlete = resolve(athleteOf(program), 'Атлет');
  const avatar = (person: ReturnType<typeof resolve>) => person.contact
    ? <CloudContactAvatar contact={person.contact} />
    : <Avatar name={person.name} src={person.self ? actor?.photoUrl ?? undefined : undefined} />;
  return (
    <GlassSurface preset="modalTuned" optics={false} className="cloud-plan-summary">
      <div className="cloud-plan-summary-content">
        <div className="cloud-plan-summary-owner">
          <div className="cloud-plan-summary-text">
            <Text variant={showName ? "body" : "headline"}>{showName ? program.name : 'Описание программы'}</Text>
            <Text variant="body">Владелец: {owner.name}</Text>
          </div>
          <div aria-label={`Аватар владельца: ${owner.name}`}>{avatar(owner)}</div>
        </div>
        <div className="cloud-plan-person-row">
          <Text variant="body">Атлет: {athlete.name}</Text>
        </div>
        <Text variant="body">Фаз: {phaseCount}</Text>
      </div>
    </GlassSurface>
  );
}
