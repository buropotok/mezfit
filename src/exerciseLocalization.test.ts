import { describe, expect, it } from 'vitest';
import russianNamesMigration from '../migrations/0014_gym_keeper_russian_names.sql?raw';
import { localizeBundledExerciseName } from './exerciseLocalization';

describe('bundled Gym Keeper Russian names', () => {
  it('uses the APK-provided canonical Russian name for Bird Dog', () => {
    expect(russianNamesMigration).toContain("WHEN 205 THEN 'Птица-собака'");
    expect(russianNamesMigration).not.toContain('Бирд Дог');
  });

  it('contains complete coverage for the 334 seeded APK GIF exercises', () => {
    const cases = russianNamesMigration.match(/^\s*WHEN \d+ THEN /gm) ?? [];
    expect(cases).toHaveLength(334);
    expect(russianNamesMigration).toContain("WHEN 1 THEN 'Ситапы'");
    expect(russianNamesMigration).toContain("WHEN 334 THEN 'Подъем колен лежа'");
  });

  it('does not translate or transliterate names at runtime', () => {
    expect(localizeBundledExerciseName('Птица-собака', 'gym_keeper_apk')).toBe('Птица-собака');
    expect(localizeBundledExerciseName('Bird Dog', 'gym_keeper_apk')).toBe('Bird Dog');
    expect(localizeBundledExerciseName('My custom exercise', null)).toBe('My custom exercise');
  });
});
