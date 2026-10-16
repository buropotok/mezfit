import { describe, expect, it, vi } from 'vitest';
import { relationshipMembership } from '../../../worker/lib/dexie-cloud-membership';
import type { MezfitCloudDatabase, CloudTrainingPlanRow } from '../cloud/database';
import type {
  CloudProgramOutline, CloudProgramExerciseRow, CloudProgramPhaseRow,
  CloudProgramDayRow, CloudWorkoutExerciseSnapshot,
} from '../cloud/workout-foundation-types';
import { isWorkoutExerciseSnapshot } from '../cloud/workout-foundation-types';
import { AssignedCoachExercisesRepository, projectAssignedCoachExercises } from './assignedCoachExercises';
import type { PublicExercise } from './publicExerciseTypes';

const coach = 'tg:101';
const client = 'tg:202';
const customId = 'custom:11111111-1111-4111-8111-111111111111';
const definition: PublicExercise = {
  id: customId, name: 'Custom press', name_ru: 'Авторский жим', name_en: 'Custom press',
  category: 'chest', subcategory: 'chest', subcategory_ru: 'Грудь',
  movement_type: 'resistance', muscles: { primary: [], secondary: [], stabilizers: [], emphasis: [] },
  mobility_targets: [], equipment: 'dumbbell', body_part: 'chest', target: 'chest',
  muscle_group: 'chest', secondary_muscles: [], media_id: '', image: '', gif_url: '',
  attribution: '', created_at: '2026-10-15', instructions: { ru: 'Нажмите', en: '' },
  instruction_steps: { ru: [], en: [] }, source_consistency_issue: null,
  anatomy_evidence: { classification_family: '', basis: '', external_individual_match: false },
};
const exerciseSnapshot: CloudWorkoutExerciseSnapshot = {
  exerciseDefinitionId: customId, scope: 'coach', name: 'Авторский жим',
  nameEn: 'Custom press', trackingType: 'weight_reps', mediaUrl: null,
  catalogueCoachUserId: coach, catalogueDefinition: definition,
};
const phase: CloudProgramPhaseRow = {
  id: 'pha-1', realmId: 'rlm-test', owner: null, trainingPlanId: 'plan-1',
  name: 'Фаза', position: 0, status: 'active', plannedStartDate: null, plannedEndDate: null,
};
const day: CloudProgramDayRow = {
  id: 'day-1', realmId: 'rlm-test', owner: null, programPhaseId: phase.id,
  name: 'День', position: 0, status: 'active',
};
const exercise: CloudProgramExerciseRow = {
  id: 'pex-1', realmId: 'rlm-test', owner: null, programDayId: day.id,
  exercise: exerciseSnapshot, position: 0, status: 'active', notes: null,
};
const outline: CloudProgramOutline = {
  planId: 'plan-1', realmId: 'rlm-test',
  phases: [{ phase, days: [{ day, exercises: [{ exercise, sets: [] }] }] }],
};

describe('client visible exercises assigned by the selected coach', () => {
  it('accepts a complete immutable custom exercise snapshot and projects one display row', () => {
    expect(isWorkoutExerciseSnapshot(exerciseSnapshot)).toBe(true);
    expect(projectAssignedCoachExercises([outline], coach)).toEqual([{
      ...definition, realmId: 'rlm-test', owner: null, sourceSha256: 'assigned-coach-snapshot',
    }]);
    expect(projectAssignedCoachExercises([outline, outline], coach)).toHaveLength(1);
  });

  it('does not surface exercises from another coach or incomplete legacy program snapshots', () => {
    expect(projectAssignedCoachExercises([outline], 'tg:303')).toEqual([]);
    const missing = structuredClone(outline);
    delete missing.phases[0].days[0].exercises[0].exercise.exercise.catalogueDefinition;
    expect(projectAssignedCoachExercises([missing], coach)).toEqual([]);
    const forged = structuredClone(outline);
    forged.phases[0].days[0].exercises[0].exercise.exercise.catalogueDefinition!.id = 'custom:22222222-2222-4222-8222-222222222222';
    expect(projectAssignedCoachExercises([forged], coach)).toEqual([]);
  });

  it('omits deprecated program exercises and days even when a snapshot exists', () => {
    const deprecated = structuredClone(outline);
    deprecated.phases[0].days[0].exercises[0].exercise.status = 'deprecated';
    expect(projectAssignedCoachExercises([deprecated], coach)).toEqual([]);
    deprecated.phases[0].days[0].exercises[0].exercise.status = 'active';
    deprecated.phases[0].days[0].day.status = 'deprecated';
    expect(projectAssignedCoachExercises([deprecated], coach)).toEqual([]);
  });

  it('checks both accepted members and the actor before reading assigned coach definitions', async () => {
    const membership = await relationshipMembership('101', '202');
    const realmId = membership.realm.realmId;
    const realm = { ...membership.realm, owner: null as null | string };
    const members = membership.members.map(m => ({
      ...m, owner: null as null | string, accepted: true, invite: false,
    }));
    const plan: CloudTrainingPlanRow = {
      id: 'plan-1', realmId, owner: null, coachUserId: coach, clientUserId: client,
      name: 'Назначенная программа', position: 0, status: 'active',
      startedAt: null, finishedAt: null, createdAt: '2026-10-15', updatedAt: '2026-10-15',
    };
    const table = <T extends { realmId: string }>(rows: T[]) => ({
      where: () => ({ equals: (value: string) => ({
        toArray: async () => rows.filter(row => row.realmId === value),
      }) }),
    });
    const exerciseRow = { ...exercise, realmId };
    const db = {
      trainingPlans: {
        get: vi.fn(async (id: string) => id === plan.id ? plan : undefined),
        where: (index: string) => ({ equals: (value: string) => ({
          toArray: async () => index === 'clientUserId' && value === client ? [plan] : [],
        }) }),
      },
      realms: { get: async (id: string) => id === realmId ? realm : undefined },
      members: { where: () => ({ equals: (_id: string) => ({
        toArray: async () => members,
      }) }) },
      programPhases: table([{ ...phase, realmId }]),
      programDays: table([{ ...day, realmId }]),
      programExercises: table([exerciseRow]),
      programSets: table([]),
    } as unknown as MezfitCloudDatabase;
    const repo = new AssignedCoachExercisesRepository(db, client);
    expect((await repo.read(coach)).map(row => row.id)).toEqual([customId]);
    expect(await repo.read('tg:303')).toEqual([]);
    // v6 headers authored through Dexie Cloud may be owned by the coach.
    plan.owner = coach;
    expect((await repo.read(coach)).map(row => row.id)).toEqual([customId]);
    // A client-owned PLAN in the coach relationship is not a valid assignment.
    plan.owner = client;
    expect(await repo.read(coach)).toEqual([]);
    plan.owner = coach;
    members[1].accepted = false;
    expect(await repo.read(coach)).toEqual([]);
  });
});
