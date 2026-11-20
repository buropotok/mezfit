import { describe, expect, it } from 'vitest';
import { canonicalEquipment, materializeExercise, normalizeEquipment, selectRussianDescription } from './build.mjs';

const sample = {
  name_ru: 'Упражнение', name: 'Exercise', source_url: 'https://fitnessprogramer.com/exercise/sample/',
  equipment: ['Full Gym', 'Machine'], image_id: 'Sample.gif', gif_url: '', tracking_type: 'weight_reps',
};
const data = { id: 'fitnessprogramer:sample', status: 'partial', category_verified: true,
  patch: { equipment: ['smith machine', 'v-grip-attachment', 'bench'], muscles: { primary: ['other', 'pectoralis_sternal'] } },
  source_path: 'assets/work/chest/sample.json', source_blob_sha: 'a'.repeat(40) };
const manifest = { id: data.id, primary_category: 'chest', category_candidates: ['chest'] };

describe('FitnessProgramer canonical materialization', () => {
  it('merges only approved equipment synonyms and keeps physical pieces together', () => {
    expect(canonicalEquipment(data.id, data.patch, sample)).toEqual(['smith machine', 'v-bar-attachment', 'bench']);
    expect(normalizeEquipment('head_harness')).toBe('neck-harness');
    expect(normalizeEquipment('back_extension_bench')).toBe('roman-chair');
    expect(normalizeEquipment('plate_loaded_shoulder_press_machine')).toBe('plate-loaded-shoulder-press-machine');
    expect(normalizeEquipment('shoulder_press_machine')).toBe('shoulder-press-machine');
  });
  it('assigns the confirmed plate to both weighted exercises', () => {
    for (const slug of ['weighted-crunch', 'weighted-back-extension']) {
      expect(canonicalEquipment('fitnessprogramer:' + slug, { equipment: ['other'] }, sample)).toContain('weight plate');
    }
  });
  it('never copies English instructions into the canonical Russian description', () => {
    expect(selectRussianDescription({ how_to: 'English only' })).toEqual({
      description: '', description_ru: '', description_en: 'English only',
    });
    expect(selectRussianDescription({ how_to: 'English', how_to_ru: 'Русский текст' }).description).toBe('Русский текст');
    expect(selectRussianDescription({ description_ru: '', how_to_ru: 'Русский текст' }).description_ru).toBe('Русский текст');
  });
  it('preserves source evidence and marks unknown anatomy rather than inventing IDs', () => {
    const card = materializeExercise(data, { ...sample, how_to: 'English only' }, manifest);
    expect(card.equipment).toEqual(['smith machine', 'v-bar-attachment', 'bench']);
    expect(card.muscles.primary).toEqual(['pectoralis_sternal']);
    expect(card.quality.unresolved_muscle_roles).toEqual(['primary']);
    expect(card.quality.missing_russian_description).toBe(true);
    expect(card.original_card.how_to).toBe('English only');
  });
});
