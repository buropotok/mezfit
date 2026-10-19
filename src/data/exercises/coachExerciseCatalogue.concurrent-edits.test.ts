import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';
import type { MezfitCloudDatabase } from '../cloud/database';
import { CoachExerciseCatalogueRepository } from './coachExerciseCatalogue';
import type { CoachExerciseDefinitionRow } from './coachExerciseTypes';

const databases: Dexie[] = [];
afterEach(async () => { for (const db of databases.splice(0)) await db.delete(); });

const exercise: CoachExerciseDefinitionRow = {
  id: 'custom:11111111-1111-4111-8111-111111111111',
  realmId: 'tg:202', owner: 'tg:202', sourceSha256: 'coach-custom',
  updatedAt: '2026-10-19', archivedAt: null,
  name: 'Press', name_ru: 'Жим', name_en: '',
  category: 'chest', subcategory: 'chest', subcategory_ru: 'Грудь',
  movement_type: 'resistance', tracking_type: 'weight_reps',
  muscles: { primary: ['pectoralis_major'], secondary: ['deltoid'], stabilizers: [], emphasis: [] },
  mobility_targets: [], equipment: 'barbell', body_part: 'chest', target: 'chest',
  muscle_group: 'chest', secondary_muscles: [], media_id: '', image: '', gif_url: '',
  attribution: '', created_at: '2026-10-18',
  instructions: { ru: 'Первоначальная инструкция', en: 'Original instructions' },
  instruction_steps: { ru: ['Шаг'], en: ['Step'] },
  source_consistency_issue: null,
  anatomy_evidence: { classification_family: '', basis: '', external_individual_match: false },
};

describe('local-first personal exercise edits', () => {
  it('preserves remotely changed sibling muscle and instruction fields', async () => {
    const db = new Dexie(`coach-exercise-merge-${crypto.randomUUID()}`);
    databases.push(db);
    db.version(1).stores({ coachExerciseDefinitions: 'id, realmId' });
    await db.table('coachExerciseDefinitions').add(structuredClone(exercise));
    const repository = new CoachExerciseCatalogueRepository(
      db as unknown as MezfitCloudDatabase, 'tg:202',
    );
    const baseline = structuredClone(exercise);
    await db.table('coachExerciseDefinitions').update(exercise.id, {
      muscles: {
        ...exercise.muscles, secondary: ['triceps'],
      },
      instructions: { ...exercise.instructions, en: 'Updated on another device' },
      instruction_steps: { ru: ['Шаг'], en: ['Updated step'] },
    });

    await repository.updateExercise(exercise.id, {
      muscles: {
        ...baseline.muscles, primary: ['biceps'],
      },
      instructions: { ...baseline.instructions, ru: 'Изменено здесь' },
      instruction_steps: { ...baseline.instruction_steps, ru: [] },
    }, baseline);

    const saved = await db.table('coachExerciseDefinitions').get(exercise.id);
    expect(saved.muscles.primary).toEqual(['biceps']);
    expect(saved.muscles.secondary).toEqual(['triceps']);
    expect(saved.instructions.ru).toBe('Изменено здесь');
    expect(saved.instructions.en).toBe('Updated on another device');
    expect(saved.instruction_steps.ru).toEqual([]);
    expect(saved.instruction_steps.en).toEqual(['Updated step']);
    expect(saved.realmId).toBe('tg:202');
  });
});
