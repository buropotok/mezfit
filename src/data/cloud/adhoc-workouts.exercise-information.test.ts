import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, expect, it } from 'vitest';
import roles from '../../../cloud/roles.json';
import { relationshipMembership } from '../../../worker/lib/dexie-cloud-membership';
import { CLOUD_DATABASE_STORES_V12, type MezfitCloudDatabase } from './database';
import { AdHocWorkoutRepository } from './adhoc-workouts';
import type { PublicExerciseRow } from '../exercises/publicExerciseTypes';

const databases: Dexie[] = [];
afterEach(async () => {
  for (const db of databases.splice(0)) await db.delete();
});

const sha = 'a'.repeat(64);
const exercise: PublicExerciseRow = {
  id: '0001', realmId: 'rlm-public', owner: null, sourceSha256: sha,
  name: 'Press', name_ru: 'Жим', name_en: 'Press', category: 'chest',
  subcategory: 'chest', subcategory_ru: 'Грудь', movement_type: 'resistance',
  tracking_type: 'weight_reps',
  muscles: { primary: [], secondary: [], stabilizers: [], emphasis: [] },
  mobility_targets: [], equipment: 'barbell', body_part: 'chest',
  target: 'chest', muscle_group: 'chest', secondary_muscles: [],
  media_id: '0001', image: '', gif_url: '', attribution: '',
  created_at: '', instructions: { ru: '', en: '' },
  instruction_steps: { ru: [], en: [] }, source_consistency_issue: null,
  anatomy_evidence: { classification_family: '', basis: '', external_individual_match: false },
};

it.each(['personal', 'shared'] as const)('loads only an authorized %s exercise snapshot, including after workout completion', async context => {
  const db = new Dexie('adhoc-info-' + crypto.randomUUID(), { addons: [] });
  databases.push(db);
  const stores: Record<string, string | null> = {};
  for (const [table, schema] of Object.entries(CLOUD_DATABASE_STORES_V12))
    stores[table] = schema?.replaceAll('@', '') ?? null;
  db.version(12).stores({ ...stores, localProgramSync: 'id', localWorkoutSync: 'id' });
  for (const table of ['adHocSessions', 'adHocExercises', 'adHocSets',
    'trainingPlans', 'programPhases', 'programDays', 'programExercises', 'programSets']) {
    db.table(table).hook('creating', key => key === undefined ? crypto.randomUUID() : undefined);
  }
  await db.table('roles').add({ realmId: 'rlm-public', name: 'coach', ...roles.roles.coach });
  await db.table('publicExerciseDefinitions').add(exercise);
  await db.table('publicExerciseCatalogues').add({
    id: 'mezfit:exercise-catalogue', realmId: 'rlm-public',
    owner: null, sourceSha256: sha, schemaVersion: '2.0.0',
    catalogue: 'mezfit.exercise_catalog.ru_anatomy',
    exerciseCount: 1324, taxonomyCount: 69, subcategoryLabelsRu: {},
    movementFamilyReferences: {}, metadata: {}, publishedAt: '2026-10-27',
  });

  const database = db as unknown as MezfitCloudDatabase;
  const owner = new AdHocWorkoutRepository(database, 'tg:101');
  const client = new AdHocWorkoutRepository(database, 'tg:202');
  const foreign = new AdHocWorkoutRepository(database, 'tg:303');
  const pair = await relationshipMembership('101', '202');
  await db.table('realms').add(pair.realm);
  await db.table('members').bulkAdd(pair.members);
  const created = context === 'shared' ? await owner.createForAthlete('tg:202') : await owner.createQuick();
  await owner.addExercises(created.id, ['0001']);
  const session = await owner.get(created.id);
  const exerciseId = session?.exercises[0]?.sessionExerciseId;
  if (!exerciseId) throw new Error('Missing exercise in session fixture');

  const details = await owner.exerciseInformation(created.id, exerciseId);
  expect(details.name).toBe('Жим');
  // This small fixture has no complete 1324-row release; the immutable snapshot remains readable.
  expect(details.row).toBeNull();
  await expect(foreign.exerciseInformation(created.id, exerciseId)).rejects.toThrow('ADHOC_SESSION_NOT_FOUND');
  await expect(owner.exerciseInformation(created.id, 'unknown')).rejects.toThrow('ADHOC_EXERCISE_NOT_FOUND');

  if (context === 'shared') {
    expect((await client.exerciseInformation(created.id, exerciseId)).name).toBe('Жим');
    await expect(client.rename(created.id, 'Изменено')).rejects.toThrow('ADHOC_WRITE_FORBIDDEN');
    await expect(client.complete(created.id)).rejects.toThrow('ADHOC_WRITE_FORBIDDEN');
    const row = await db.table('adHocExercises').get(exerciseId);
    await db.table('adHocExercises').put({ ...row, id: 'other-exercise', sessionId: 'other-session' });
    await expect(client.exerciseInformation(created.id, 'other-exercise')).rejects.toThrow('ADHOC_EXERCISE_NOT_FOUND');
    await db.table('adHocExercises').put({ ...row, id: 'foreign-realm-exercise', realmId: 'foreign-realm' });
    await expect(client.exerciseInformation(created.id, 'foreign-realm-exercise')).rejects.toThrow('ADHOC_EXERCISE_NOT_FOUND');
  } else {
    await expect(client.exerciseInformation(created.id, exerciseId)).rejects.toThrow('ADHOC_SESSION_NOT_FOUND');
  }

  await owner.complete(created.id);
  expect((await owner.exerciseInformation(created.id, exerciseId)).name).toBe('Жим');
  if (context === 'shared') {
    expect((await client.exerciseInformation(created.id, exerciseId)).name).toBe('Жим');
    await db.table('members').delete(pair.members[1].id);
    await expect(client.exerciseInformation(created.id, exerciseId)).rejects.toThrow('ADHOC_SESSION_NOT_FOUND');
  }
});
