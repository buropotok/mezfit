import { describe, expect, it } from 'vitest';
import source from './GlobalExerciseCatalog.tsx?raw';
import apiSource from '../api.ts?raw';

describe('Gym Keeper global exercise catalogue parity', () => {
  it('keeps category-first navigation and badge filters', () => {
    for (const label of ['Грудь', 'Руки', 'Спина', 'Ноги', 'Плечи', 'Корпус', 'Фулбоди', 'Кардио', 'Другое']) {
      expect(source).toContain(label);
    }
    expect(source).toContain('catalog-chip-row');
    expect(source).toContain('Только избранные');
    expect(source).toContain('Свой вес');
    expect(source).toContain('Гантели x2');
  });

  it('uses the UI Kit row menu as the action gateway', () => {
    for (const action of ['Информация', 'Добавить в избранное', 'Дублировать', 'Редактировать']) {
      expect(source).toContain(action);
    }
    expect(source).toContain('row-menu');
    expect(source).toContain('Menu, MenuItem');
    expect(source).toContain('<Menu isOpen={menuExercise?.id === exercise.id}');
    expect(source).not.toContain('ExerciseContextMenu');
    expect(source).not.toContain('onClick={() => void openExercise(exercise)}');
  });

  it('reuses one editor flow for create, duplicate and editable exercises', () => {
    expect(source).toContain('ExerciseEditorDialog');
    expect(source).toContain("mode: 'create'");
    expect(source).toContain("mode: 'edit'");
  });

  it('delegates coach catalogue search to the bilingual server search', () => {
    expect(source).toContain("getCoachExercises(initData, { search, categoryCode: selectedCategory ?? '', sort: 'alphabetical' })");
    expect(source).not.toContain("exerciseDisplayName(exercise).toLocaleLowerCase('ru-RU').includes(needle)");
    expect(apiSource).toContain("query.set('search', filters.search.trim())");
  });

  it('ignores responses from superseded catalogue requests', () => {
    expect(source).toContain('let cancelled = false');
    expect(source).toContain('if (!isCurrent()) return; setExercises(result.exercises)');
    expect(source).toContain('if (!isCurrent()) return; setError(');
    expect(source).toContain('cancelled = true; window.clearTimeout(timer)');
  });
});
