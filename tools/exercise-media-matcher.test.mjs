import { describe, expect, it } from 'vitest';
import { matchExercise, normalizeName, parseApkReference } from './exercise-media-matcher.mjs';

describe('exercise media matcher', () => {
  it('normalizes aliases and noise', () => {
    expect(normalizeName('Dumbbells Curls (male)')).toBe('dumbbell curl');
  });

  it('parses APK name and body part', () => {
    expect(parseApkReference('12411305-Bird-Dog-male_Back_180.gif')).toEqual({ name: 'Bird Dog male', bodyPart: 'back' });
  });

  it('accepts exact normalized name', () => {
    const result = matchExercise('00311305-Barbell-Curl_Upper-Arms_180.gif', [
      { id: '1', name: 'barbell curl', body_part: 'upper arms', equipment: 'barbell' },
    ]);
    expect(result.exercise?.id).toBe('1');
    expect(result.match).toBe('exact');
  });

  it('uses body part and equipment to select a close candidate', () => {
    const exercises = [
      { id: 'a', name: 'dumbbell single arm row', body_part: 'back', equipment: 'dumbbell' },
      { id: 'b', name: 'single arm row', body_part: 'back', equipment: 'cable' },
    ];
    expect(matchExercise('99991305-Dumbbell-One-Arm-Row_Back_180.gif', exercises).exercise?.id).toBe('a');
  });

  it('rejects genuinely ambiguous candidates', () => {
    const exercises = [
      { id: 'a', name: 'dumbbell standing front raise', body_part: 'shoulders', equipment: 'dumbbell' },
      { id: 'b', name: 'dumbbell standing lateral raise', body_part: 'shoulders', equipment: 'dumbbell' },
    ];
    const result = matchExercise('99991305-Dumbbell-Standing-Raise_Shoulders_180.gif', exercises);
    expect(result.exercise).toBeNull();
    expect(result.match).toBe('unmatched');
  });
});
