export type ProgramStatus = 'active' | 'draft' | 'finished';

export interface ProgramListItem {
  id: number;
  userId: number;
  name: string;
  status: ProgramStatus;
  startedAt: string | null;
  finishedAt: string | null;
  position: number;
}

export interface ProgramOwner {
  id: number;
  firstName: string;
  lastName: string | null;
  username: string | null;
  photoUrl: string | null;
}

export interface ProgramOwnerGroup {
  owner: ProgramOwner;
  programs: ProgramListItem[];
}

interface ProgramRow {
  id: number;
  user_id: number;
  owner_coach_user_id: number | null;
  created_by_user_id: number;
  name: string;
  status: ProgramStatus;
  started_at: string | null;
  finished_at: string | null;
  position: number;
}

interface CoachProgramRow extends ProgramRow {
  first_name: string;
  last_name: string | null;
  username: string | null;
  photo_url: string | null;
}

const programProjection = `
  SELECT
    tp.id,
    tp.user_id,
    tp.owner_coach_user_id,
    tp.created_by_user_id,
    tp.name,
    tp.position,
    CASE
      WHEN EXISTS (
        SELECT 1 FROM program_phase active_phase
        WHERE active_phase.training_plan_id = tp.id AND active_phase.status = 'active'
      ) THEN 'active'
      WHEN EXISTS (
        SELECT 1 FROM program_phase any_phase
        WHERE any_phase.training_plan_id = tp.id
      ) AND NOT EXISTS (
        SELECT 1 FROM program_phase unfinished_phase
        WHERE unfinished_phase.training_plan_id = tp.id AND unfinished_phase.status != 'finished'
      ) THEN 'finished'
      ELSE 'draft'
    END AS status,
    (
      SELECT MIN(started_phase.started_at)
      FROM program_phase started_phase
      WHERE started_phase.training_plan_id = tp.id AND started_phase.started_at IS NOT NULL
    ) AS started_at,
    CASE
      WHEN EXISTS (
        SELECT 1 FROM program_phase any_phase
        WHERE any_phase.training_plan_id = tp.id
      ) AND NOT EXISTS (
        SELECT 1 FROM program_phase unfinished_phase
        WHERE unfinished_phase.training_plan_id = tp.id AND unfinished_phase.status != 'finished'
      ) THEN (
        SELECT MAX(finished_phase.finished_at)
        FROM program_phase finished_phase
        WHERE finished_phase.training_plan_id = tp.id AND finished_phase.finished_at IS NOT NULL
      )
      ELSE NULL
    END AS finished_at
  FROM training_plan tp
`;

function mapProgram(row: ProgramRow): ProgramListItem {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    status: row.status,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    position: row.position,
  };
}

export async function listProgramsForUserByCoach(
  db: D1Database,
  userId: number,
  coachUserId: number,
): Promise<ProgramListItem[]> {
  const result = await db
    .prepare(`${programProjection} WHERE tp.user_id = ? AND COALESCE(tp.owner_coach_user_id, tp.created_by_user_id) = ? ORDER BY tp.position, tp.id`)
    .bind(userId, coachUserId)
    .all<ProgramRow>();
  return result.results.map(mapProgram);
}

export async function listClientProgramsForCoach(db: D1Database, coachUserId: number): Promise<ProgramOwnerGroup[]> {
  const result = await db
    .prepare(`
      SELECT programs.*, client.first_name, client.last_name, client.username, client.photo_url
      FROM (${programProjection}) programs
      JOIN coach_client cc
        ON cc.client_user_id = programs.user_id
       AND cc.coach_user_id = COALESCE(programs.owner_coach_user_id, programs.created_by_user_id)
       AND cc.coach_user_id = ?
       AND cc.status = 'active'
      JOIN app_user client ON client.id = programs.user_id
      ORDER BY COALESCE(client.last_name, ''), client.first_name, client.id, programs.position, programs.id
    `)
    .bind(coachUserId)
    .all<CoachProgramRow>();

  const groups = new Map<number, ProgramOwnerGroup>();
  for (const row of result.results) {
    let group = groups.get(row.user_id);
    if (!group) {
      group = {
        owner: {
          id: row.user_id,
          firstName: row.first_name,
          lastName: row.last_name,
          username: row.username,
          photoUrl: row.photo_url,
        },
        programs: [],
      };
      groups.set(row.user_id, group);
    }
    group.programs.push(mapProgram(row));
  }
  return [...groups.values()];
}
