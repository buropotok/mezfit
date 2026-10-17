import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { WorkedMuscles } from './WorkedMuscles';
import {
  FEMALE_WORKED_MUSCLE_VIEWS,
  getWorkedMuscleViewConfig,
  WORKED_MUSCLES,
  WORKED_MUSCLE_VIEWS,
} from './workedMuscleData';
import { parseWorkedMuscleAtlasManifest } from './workedMuscleAtlas';

describe('WorkedMuscles sex selection', () => {
  const props = { primaryMuscleIds: ['latissimus_dorsi'], secondaryMuscleIds: ['rhomboids'] };

  it('defaults to the female atlas and provides a manual sex switch', () => {
    const html = renderToStaticMarkup(<WorkedMuscles {...props} />);
    expect(html).toContain('worked-muscles__canvas--female-front');
    expect(html).toContain('worked-muscles__canvas--female-rear');
    expect(html).toContain('Пол анатомической модели');
    expect(html).toContain('Женский');
    expect(html).toContain('Мужской');
  });

  it('uses a supplied sex without exposing a manual switch', () => {
    const male = renderToStaticMarkup(<WorkedMuscles {...props} sex="male" />);
    const female = renderToStaticMarkup(<WorkedMuscles {...props} sex="female" />);
    expect(male).toContain('worked-muscles__canvas--male-front');
    expect(male).toContain('worked-muscles__canvas--male-rear');
    expect(female).toContain('worked-muscles__canvas--female-front');
    expect(male).not.toContain('Пол анатомической модели');
    expect(female).not.toContain('Пол анатомической модели');
  });
});

describe('Female anatomy contracts', () => {
  it('keeps original male asset configuration unchanged', () => {
    expect(getWorkedMuscleViewConfig('male', 'front')).toBe(WORKED_MUSCLE_VIEWS.front);
    expect(getWorkedMuscleViewConfig('male', 'rear')).toBe(WORKED_MUSCLE_VIEWS.rear);
  });

  it('provides canonical muscle IDs across both female projections', () => {
    const union = new Set([
      ...Object.values(FEMALE_WORKED_MUSCLE_VIEWS.front.indices),
      ...Object.values(FEMALE_WORKED_MUSCLE_VIEWS.rear.indices),
    ]);
    expect(union).toEqual(new Set(WORKED_MUSCLES.map((m) => m.id)));
    expect(getWorkedMuscleViewConfig('female', 'front').width).toBe(1229);
    expect(getWorkedMuscleViewConfig('female', 'rear').height).toBe(1448);
  });

  it('validates female manifest dimensions and canonical numeric mappings', () => {
    const sprite = {
      index: 1,
      id: FEMALE_WORKED_MUSCLE_VIEWS.front.indices[1],
      label: 'Тест',
      category: 'Грудь',
      atlasX: 5, atlasY: 10, targetX: 15, targetY: 30, width: 20, height: 40,
    };
    const manifest = {
      view: 'front', width: 1229, height: 1536, tonePercent: null,
      sprites: { '1': sprite },
    };
    expect(parseWorkedMuscleAtlasManifest(manifest, 'front', 100, 100, 'female')['1'].id).toBe(sprite.id);
    expect(() => parseWorkedMuscleAtlasManifest({ ...manifest, width: 1024 }, 'front', 100, 100, 'female')).toThrow();
    expect(() => parseWorkedMuscleAtlasManifest({
      ...manifest, sprites: { '1': { ...sprite, id: 'unknown' } },
    }, 'front', 100, 100, 'female')).toThrow();
  });
});
