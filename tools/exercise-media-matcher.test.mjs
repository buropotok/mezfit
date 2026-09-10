import { describe, expect, it } from 'vitest';
import { normalizeName, parseApkReference, matchExercise } from './exercise-media-matcher.mjs';

describe('exercise media matcher', () => {
  it('normalizes aliases and noise', () => expect(normalizeName('Dumbbells Curls (male)')).toBe('dumbbell curl'));
  it('parses APK name and body part', () => expect(parseApkReference('12411305-Bird-Dog-male_Back_180.gif')).toEqual({ name: 'Bird Dog male', bodyPart: 'back' }));
  it('accepts exact normalized name', () => {
    const r = matchExercise('00311305-Barbell-Curl_Upper-Arms_180.gif', [{ id: '1', name: 'barbell curl', body_part: 'upper arms', equipment: 'barbell' }]);
    expect(r.exercise.id).toBe('1');
    expect(r.match).toBe('exact');
  });
  it('uses body part and equipment to select a close candidate', () => {
    const xs = [{ id: 'a', name: 'dumbbell single arm row', body_part: 'back', equipment: 'dumbbell' }, { id: 'b', name: 'single arm row', body_part: 'back', equipment: 'cable' }];
    expect(matchExercise('99991305-Dumbbell-One-Arm-Row_Back_180.gif', xs).exercise?.id).toBe('a');
  });
  it('rejects genuinely ambiguous candidates', () => {
    const xs = [{ id: 'a', name: 'dumbbell standing front raise', body_part: 'shoulders', equipment: 'dumbbell' }, { id: 'b', name: 'dumbbell standing lateral raise', body_part: 'shoulders', equipment: 'dumbbell' }];
    expect(matchExercise('99991305-Dumbbell-Standing-Raise_Shoulders_180.gif', xs).exercise).toBeNull();
  });
});
