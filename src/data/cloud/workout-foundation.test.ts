import { describe, expect, it, vi } from 'vitest';
import currentRoles from '../../../cloud/roles.json';
import serverSchema from '../../../cloud/schema-workout-foundation.json';
import { relationshipMembership } from '../../../worker/lib/dexie-cloud-membership';
import {
  CLOUD_DATABASE_VERSION, CLOUD_DATABASE_STORES_V3, CLOUD_DATABASE_STORES_V4,
  CLOUD_DATABASE_STORES_V5, CLOUD_DATABASE_STORES_V6,
  type CloudTrainingPlanRow, type MezfitCloudDatabase,
} from './database';
import { WorkoutFoundationRepository } from './workout-foundation';
import type {
  CloudProgramPhaseRow, CloudProgramDayRow, CloudProgramExerciseRow, CloudProgramSetRow,
} from './workout-foundation-types';

const newTables = [
  'programPhases', 'programDays', 'programExercises', 'programSets',
  'workoutOccurrences', 'sessionExercises', 'sessionFactExercises', 'sessionFactSets',
] as const;

describe('Dexie Cloud v4 workout foundation', () => {
  it('keeps eight relationship domain tables with globally unique keys', () => {
    expect(CLOUD_DATABASE_VERSION).toBe(7);
    // v5's coach-private catalogue survives PLAN v6.
    expect(Object.keys(CLOUD_DATABASE_STORES_V5)).toContain('coachExerciseDefinitions');
    expect(Object.keys(CLOUD_DATABASE_STORES_V6)).toEqual(Object.keys(CLOUD_DATABASE_STORES_V5));
    expect(CLOUD_DATABASE_STORES_V6.trainingPlans).toContain('[realmId+status]');
    expect(CLOUD_DATABASE_STORES_V6.programPhases).toContain('[trainingPlanId+status]');
    expect(CLOUD_DATABASE_STORES_V6.programPhases).toContain('[realmId+status]');
    expect(Object.keys(CLOUD_DATABASE_STORES_V4)).toEqual([
      ...Object.keys(CLOUD_DATABASE_STORES_V3), ...newTables,
    ]);
    for (const table of newTables) {
      expect(CLOUD_DATABASE_STORES_V4[table]).toMatch(/^@id, realmId/);
      expect(serverSchema.schema[table]).toBe('@id');
    }
    expect(Object.keys(serverSchema.schema)).toEqual([...newTables]);
    expect(CLOUD_DATABASE_STORES_V4.programPhases).toContain('trainingPlanId');
    expect(CLOUD_DATABASE_STORES_V4.programDays).toContain('programPhaseId');
    expect(CLOUD_DATABASE_STORES_V4.programExercises).toContain('programDayId');
    expect(CLOUD_DATABASE_STORES_V4.programSets).toContain('programExerciseId');
    expect(CLOUD_DATABASE_STORES_V4.sessionExercises).toContain('workoutSessionId');
    expect(CLOUD_DATABASE_STORES_V4.sessionFactExercises).toContain('workoutSessionId');
    expect(CLOUD_DATABASE_STORES_V4.sessionFactSets).toContain('sessionFactExerciseId');
    for (const [table, declaration] of Object.entries(CLOUD_DATABASE_STORES_V3)) {
      expect(CLOUD_DATABASE_STORES_V4[table as keyof typeof CLOUD_DATABASE_STORES_V3]).toBe(declaration);
    }
  });

  it('grants Coach PLAN descendants while keeping Client and execution tables read-only', () => {
    const coach = currentRoles.roles.coach.permissions;
    const client = currentRoles.roles.client.permissions;
    expect(coach.manage).toEqual(['trainingPlans', 'programPhases', 'programDays', 'programExercises', 'programSets']);
    for (const table of newTables.filter((name) => !['programPhases', 'programDays', 'programExercises', 'programSets'].includes(name))) {
      expect(JSON.stringify(coach)).not.toContain('"' + table + '"');
    }
    for (const table of newTables) {
      expect(JSON.stringify(client)).not.toContain('"' + table + '"');
    }
    expect(coach.update.sessionSetFacts).not.toContain('*');
    expect(client.update.sessionSetFacts).not.toContain('*');
    expect(Object.hasOwn(client, 'manage')).toBe(false);
  });
});

async function fixture() {
  const membership = await relationshipMembership('101', '202');
  const realmId = membership.realm.realmId;
  const realm = { ...membership.realm, owner: null as null | string };
  const members = membership.members.map((member) => ({
    ...member, owner: null as null | string, accepted: true, invite: false,
  }));
  const plan: CloudTrainingPlanRow = {
    id: 'tra-sample', realmId, owner: null, coachUserId: 'tg:101', clientUserId: 'tg:202',
    name: 'Программа', status: 'active', position: 0, startedAt: null, finishedAt: null,
    createdAt: '2026-10-14', updatedAt: '2026-10-14',
  };
  const phase: CloudProgramPhaseRow = {
    id: 'pha-1', realmId, owner: null, trainingPlanId: plan.id,
    name: 'Фаза', position: 0, status: 'active', plannedStartDate: null, plannedEndDate: null,
  };
  const day: CloudProgramDayRow = {
    id: 'day-1', realmId, owner: null, programPhaseId: phase.id,
    name: 'День 1', position: 0, status: 'active',
  };
  const exercise: CloudProgramExerciseRow = {
    id: 'pex-1', realmId, owner: null, programDayId: day.id,
    exercise: {
      exerciseDefinitionId: '0001', scope: 'public', name: 'Жим лёжа',
      nameEn: 'Bench press', trackingType: 'weight_reps', mediaUrl: null,
    },
    position: 0, status: 'active', notes: null,
  };
  const set: CloudProgramSetRow = {
    id: 'pst-1', realmId, owner: null, programExerciseId: exercise.id,
    position: 0, status: 'active', plannedReps: 8, plannedWeightKg: 60,
    plannedDurationSeconds: null, plannedDistanceMeters: null,
  };

  const planGet = vi.fn(async (id: string) => id === plan.id ? plan : undefined);
  const realmGet = vi.fn(async (id: string) => id === realmId ? realm : undefined);
  const table = <T extends { realmId: string }>(rows: T[]) => ({
    where: (_index: string) => ({
      equals: (value: string) => ({
        toArray: async () => rows.filter((row) => row.realmId === value),
      }),
    }),
  });
  const phases = [
    phase,
    { ...phase, id: 'pha-stray', trainingPlanId: 'tra-other' },
    { ...phase, id: 'pha-forged-owner', owner: 'tg:303' },
  ];
  const days = [
    day,
    { ...day, id: 'day-stray', programPhaseId: 'pha-stray' },
    { ...day, id: 'day-owned', owner: 'tg:202' },
  ];
  const exercises = [
    exercise,
    { ...exercise, id: 'pex-stray', programDayId: 'day-stray' },
    { ...exercise, id: 'pex-other-realm', realmId: 'rlm-foreign' },
    { ...exercise, id: 'pex-owned', owner: 'tg:303' },
  ];
  const sets = [
    set,
    { ...set, id: 'pst-stray', programExerciseId: 'pex-stray' },
    { ...set, id: 'pst-owned', owner: 'tg:202' },
  ];

  const db = {
    trainingPlans: { get: planGet },
    realms: { get: realmGet },
    members: { where: () => ({ equals: () => ({ toArray: async () => members }) }) },
    programPhases: table(phases),
    programDays: table(days),
    programExercises: table(exercises),
    programSets: table(sets),
  } as unknown as MezfitCloudDatabase;
  return { db, plan, phase, realm, realmId, members, planGet, realmGet, exercises };
}

describe('read-only shared workout PLAN repository', () => {
  it('projects PLAN without dangling, foreign-realm or unauthorized-owner children', async () => {
    const f = await fixture();
    const repo = new WorkoutFoundationRepository(f.db, 'tg:101');
    const result = await repo.getProgramOutline(f.plan.id);
    expect(result?.realmId).toBe(f.realmId);
    expect(result?.phases).toHaveLength(1);
    expect(result?.phases[0].days).toHaveLength(1);
    expect(result?.phases[0].days[0].exercises).toHaveLength(1);
    expect(result?.phases[0].days[0].exercises[0].sets).toHaveLength(1);
    expect(result?.phases[0].days[0].exercises[0].exercise.exercise.exerciseDefinitionId).toBe('0001');
  });

  it('accepts authorized coach-owned program and phase headers', async () => {
    const f = await fixture();
    f.plan.owner = 'tg:101';
    f.phase.owner = 'tg:101';
    const repo = new WorkoutFoundationRepository(f.db, 'tg:202');
    const outline = await repo.getProgramOutline(f.plan.id);
    expect(outline?.phases[0].phase.owner).toBe('tg:101');
    expect(outline?.phases[0].days).toHaveLength(1);
    f.phase.owner = 'tg:303';
    expect((await repo.getProgramOutline(f.plan.id))?.phases).toHaveLength(0);
  });

  it('ignores legacy tracking metadata when projecting a reusable program', async () => {
    const f = await fixture();
    const repo = new WorkoutFoundationRepository(f.db, 'tg:101');
    Object.assign(f.exercises[0].exercise, { trackingType: 'legacy_unknown' });
    const outline = await repo.getProgramOutline(f.plan.id);
    expect(outline?.phases[0].days[0].exercises[0].exercise.exercise.exerciseDefinitionId).toBe('0001');
  });

  it('rejects incomplete synced exercise snapshots', async () => {
    const f = await fixture();
    const repo = new WorkoutFoundationRepository(f.db, 'tg:101');
    Object.assign(f.exercises[0], { exercise: { trackingType: 'time' } });
    await expect(repo.getProgramOutline(f.plan.id))
      .rejects.toThrow('INVALID_CLOUD_WORKOUT_EXERCISE_SNAPSHOT');
  });

  it('projects program exercises without tracking metadata', async () => {
    const f = await fixture();
    const repo = new WorkoutFoundationRepository(f.db, 'tg:101');
    delete f.exercises[0].exercise.trackingType;
    const outline = await repo.getProgramOutline(f.plan.id);
    expect(outline?.phases[0].days[0].exercises[0].exercise.exercise.exerciseDefinitionId).toBe('0001');
  });

  it('allows the accepted client to read the same outline without authoring capabilities', async () => {
    const f = await fixture();
    const repo = new WorkoutFoundationRepository(f.db, 'tg:202');
    expect((await repo.getProgramOutline(f.plan.id))?.planId).toBe(f.plan.id);
    expect('createProgram' in repo).toBe(false);
    expect('addExercise' in repo).toBe(false);
  });

  it('fails closed for another client, malformed identity, and foreign plan', async () => {
    const f = await fixture();
    expect(await new WorkoutFoundationRepository(f.db, 'tg:303')
      .getProgramOutline(f.plan.id)).toBeNull();
    expect(await new WorkoutFoundationRepository(f.db, 'tg:101x')
      .getProgramOutline(f.plan.id)).toBeNull();
    expect(await new WorkoutFoundationRepository(f.db, 'tg:101')
      .getProgramOutline('tra-missing')).toBeNull();
    expect(f.realmGet).not.toHaveBeenCalled();
  });

  it('refuses ownerful realms and forged/unaccepted memberships', async () => {
    const f = await fixture();
    const repo = new WorkoutFoundationRepository(f.db, 'tg:101');
    f.realm.owner = 'tg:101';
    expect(await repo.getProgramOutline(f.plan.id)).toBeNull();
    f.realm.owner = null;
    f.members[1].accepted = false;
    expect(await repo.getProgramOutline(f.plan.id)).toBeNull();
  });
});
