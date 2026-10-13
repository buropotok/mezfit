import { describe, expect, it } from 'vitest';
import { filterPublicExercises, filterOptions, type SelectedFilters } from './publicExerciseFilters';
import type { PublicExerciseRow, PublicTaxonomyRow } from './publicExerciseTypes';

const base: PublicExerciseRow = {
  id: '0001', name: 'Жим', name_ru: 'Жим лёжа', name_en: 'Bench press',
  category: 'chest', subcategory: 'upper_chest', subcategory_ru: 'Верх груди',
  movement_type: 'resistance', muscles: {
    primary: ['pectoralis_major'], secondary: ['triceps'], stabilizers: ['serratus'], emphasis: ['pectoral_zone'],
  }, mobility_targets: [], equipment: 'barbell', body_part: 'chest', target: 'pectorals', muscle_group: 'chest',
  secondary_muscles: [], media_id: 'sample', image: 'images/0001-sample.jpg',
  gif_url: 'videos/0001-sample.gif', attribution: '© Gym visual', created_at: '2026-03-18T12:00:00Z',
  instructions: { en: 'Press.', ru: 'Жмите.' }, instruction_steps: { en: ['Press.'], ru: ['Жмите.'] },
  source_consistency_issue: null, anatomy_evidence: { classification_family: 'press', basis: 'source', external_individual_match: false },
  realmId: 'rlm-public', owner: null, sourceSha256: 'a'.repeat(64),
};
const second: PublicExerciseRow = {
  ...base, id: '0002', name_ru: 'Разведение рук', name_en: 'Fly', category: 'chest', equipment: 'dumbbell',
  muscles: { primary: ['pectoralis_minor'], secondary: [], stabilizers: [], emphasis: [] },
};
const third: PublicExerciseRow = {
  ...base, id: '0003', category: 'back', name_ru: 'Тяга', name_en: 'Row',
  muscles: { primary: ['latissimus'], secondary: ['triceps'], stabilizers: [], emphasis: [] },
};
const taxonomy: PublicTaxonomyRow[] = [
  { id: 'pectoralis_major', kind: 'muscle', parent_id: null, category_ru: 'Грудь', subcategory_ru: 'Большая грудная', anatomical_description_ru: 'Большая грудная', realmId: 'rlm-public', owner: null, sourceSha256: base.sourceSha256 },
  { id: 'pectoral_zone', kind: 'zone', parent_id: 'pectoralis_major', category_ru: 'Грудь', subcategory_ru: 'Верхняя зона', anatomical_description_ru: 'Зона', realmId: 'rlm-public', owner: null, sourceSha256: base.sourceSha256 },
  ...['triceps', 'pectoralis_minor', 'latissimus', 'serratus'].map((id): PublicTaxonomyRow => ({
    id, kind: 'muscle', parent_id: null, category_ru: '', subcategory_ru: id,
    anatomical_description_ru: id, realmId: 'rlm-public', owner: null, sourceSha256: base.sourceSha256,
  })),
];
const exercises = [base, second, third];
const run = (filters: SelectedFilters, query = '', category: string | null = null) =>
  filterPublicExercises(exercises, taxonomy, filters, query, category).map((row) => row.id);

describe('read-only public exercise filters', () => {
  it('preserves original string IDs and searches locally by Russian and English names', () => {
    expect(run({}, ' BENCH ')).toEqual(['0001']);
    expect(run({}, 'разведение')).toEqual(['0002']);
  });
  it('ORs within a group and ANDs independent groups', () => {
    expect(run({ category: ['chest', 'back'], equipment: ['dumbbell'] })).toEqual(['0002']);
  });
  it('intersects with the surrounding category view', () => {
    expect(run({ category: ['back'] }, '', 'chest')).toEqual([]);
  });
  it('matches exact taxonomy ID without auto-expanding parent to zone or child', () => {
    expect(run({ primary: ['pectoralis_major'] })).toEqual(['0001']);
    expect(run({ primary: ['pectoral_zone'] })).toEqual([]);
    expect(run({ zone: ['pectoral_zone'] })).toEqual(['0001']);
  });
  it('keeps emphasis and mobility targets out of primary / all muscles', () => {
    expect(run({ all_muscles: ['pectoral_zone'] })).toEqual([]);
    expect(run({ emphasis: ['pectoral_zone'] })).toEqual(['0001']);
  });
  it('exposes only populated filter options', () => {
    expect(filterOptions('primary', exercises, taxonomy, {}).map((option) => option.id))
      .toEqual(expect.arrayContaining(['pectoralis_major', 'pectoralis_minor', 'latissimus']));
  });
});
