import { describe, expect, it } from 'vitest';
import { localizeBundledExerciseName } from './exerciseLocalization';

describe('bundled exercise Russian UI', () => {
  it('localizes common APK catalogue names without Latin UI text', () => {
    const bench = localizeBundledExerciseName('Barbell Bench Press', 'gym_keeper_apk');
    const curl = localizeBundledExerciseName('Dumbbell Hammer Curl', 'gym_keeper_apk');

    expect(bench).toContain('Жим лёжа');
    expect(bench).toContain('штанга');
    expect(curl).toContain('Молотковые сгибания рук');
    expect(bench).not.toMatch(/[A-Za-z]/);
    expect(curl).not.toMatch(/[A-Za-z]/);
  });

  it('does not rewrite user-authored custom names', () => {
    expect(localizeBundledExerciseName('My custom exercise', null)).toBe('My custom exercise');
  });
});
