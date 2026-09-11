import { describe, expect, it } from 'vitest';
import { normalizeName, parseApkReference, matchExercise } from './exercise-media-matcher.mjs';

describe('exercise media matcher', () => {
  it('normalizes aliases and noise', () => expect(normalizeName('Dumbbells Curls (male)')).toBe('dumbbell curl'));
  it('normalizes version spelling and known dataset typo', () => {
    expect(normalizeName('Decline Shrug (VERSION 2)')).toBe('decline shrug v 2');
    expect(normalizeName('wheel rollerout')).toBe('wheel rollout');
  });
  it('parses APK name and body part', () => expect(parseApkReference('12411305-Bird-Dog-male_Back_180.gif')).toEqual({ name: 'Bird Dog male', bodyPart: 'back' }));
  it('strips APK media metadata from body part', () => {
    expect(parseApkReference('03041305-Dumbbell-Decline-Shrug-(VERSION-2)_Back-FIX_180.gif').bodyPart).toBe('back');
    expect(parseApkReference('05641305-Lateral-Box-Jump_Plyometrics-copy_180.gif').bodyPart).toBe('plyometrics');
    expect(parseApkReference('10631305-Barbell-sumo-squat_Thighs-AFIX_180.gif').bodyPart).toBe('thighs');
  });
  it('accepts exact normalized name', () => {
    const r = matchExercise('00311305-Barbell-Curl_Upper-Arms_180.gif', [{ id: '1', name: 'barbell curl', body_part: 'upper arms', equipment: 'barbell' }]);
    expect(r.exercise.id).toBe('1');
    expect(r.match).toBe('exact');
  });
  it('accepts duplicate dataset rows only when name, body part and equipment are equivalent', () => {
    const xs = [
      { id: 'a', name: 'EZ Barbell Spider Curl', body_part: 'upper arms', equipment: 'barbell' },
      { id: 'b', name: 'EZ Barbell Spider Curl', body_part: 'upper arms', equipment: 'barbell' },
    ];
    const r = matchExercise('04541305-EZ-Barbell-Spider-Curl_Upper-Arms_180.gif', xs);
    expect(r.exercise?.id).toBe('a');
    expect(r.match).toBe('equivalent_duplicate');
  });
  it('does not collapse gender-distinct duplicate candidates', () => {
    const xs = [
      { id: 'a', name: 'jumping jack male', body_part: 'cardio', equipment: 'body weight' },
      { id: 'b', name: 'jumping jack female', body_part: 'cardio', equipment: 'body weight' },
    ];
    expect(matchExercise('99991305-Jumping-Jack_Cardio_180.gif', xs).exercise).toBeNull();
  });
  it('uses body part and equipment to select a close candidate', () => {
    const xs = [{ id: 'a', name: 'dumbbell single arm row', body_part: 'back', equipment: 'dumbbell' }, { id: 'b', name: 'single arm row', body_part: 'back', equipment: 'cable' }];
    expect(matchExercise('99991305-Dumbbell-One-Arm-Row_Back_180.gif', xs).exercise?.id).toBe('a');
  });
  it('accepts only explicit conservative semantic aliases', () => {
    const cases = [
      ['18591305-Cable-Kneeling-Triceps-Extension-(VERSION-2)_Upper-Arms_180.gif', 'cable kneeling triceps extension'],
      ['60361305-Cable-Straight-Arm-Pulldown-(VERSION-2)_Back_180.gif', 'cable straight arm pulldown'],
      ['22851305-Lever-Pullover-(plate-loaded)_Back_180.gif', 'lever pullover'],
      ['05941305-Lever-Seated-Calf-Raise-(plate-loaded)_Calf_180.gif', 'lever seated calf raise'],
      ['05931305-Lever-Reverse-Hyperextension-(plate-loaded)_Hips_180.gif', 'lever reverse hyperextension'],
      ['51191305-Dumbbell-Deadlift-(VERSION-2)-(male)_Hips_180.gif', 'dumbbell deadlift'],
      ['37131305-Dumbbell-Standing-Single-Leg-Calf-Raise_Calves_180.gif', 'dumbbell single leg calf raise'],
      ['21921305-Elliptical-Machine-Walk_Cardio_180.gif', 'walk elliptical cross trainer'],
    ];
    for (const [key, name] of cases) {
      const r = matchExercise(key, [{ id: name, name, body_part: 'x', equipment: 'x' }]);
      expect(r.exercise?.id).toBe(name);
      expect(r.match).toBe('semantic_alias');
    }
  });
  it('does not use a semantic alias when its dataset target is ambiguous', () => {
    const xs = [
      { id: 'a', name: 'lever pullover', body_part: 'back', equipment: 'lever' },
      { id: 'b', name: 'lever pullover', body_part: 'back', equipment: 'cable' },
    ];
    expect(matchExercise('22851305-Lever-Pullover-(plate-loaded)_Back_180.gif', xs).exercise).toBeNull();
  });
  it('rejects genuinely ambiguous candidates', () => {
    const xs = [{ id: 'a', name: 'dumbbell standing front raise', body_part: 'shoulders', equipment: 'dumbbell' }, { id: 'b', name: 'dumbbell standing lateral raise', body_part: 'shoulders', equipment: 'dumbbell' }];
    expect(matchExercise('99991305-Dumbbell-Standing-Raise_Shoulders_180.gif', xs).exercise).toBeNull();
  });
});
