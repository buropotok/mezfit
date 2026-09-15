import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ProgramPhaseDetails } from '../api';
import { ProgramPhaseCard } from './ProgramPhaseCard';

const phase: ProgramPhaseDetails = {
  id: 12,
  name: 'Базовая фаза',
  position: 0,
  status: 'active',
  plannedStartDate: '2026-09-01',
  plannedEndDate: '2026-09-30',
  startedAt: '2026-09-01T09:00:00Z',
  finishedAt: null,
  completedExerciseCount: 1,
  exerciseCount: 2,
  progressPercent: 50,
  exercises: [
    {
      programExerciseId: 101,
      dayId: 41,
      dayName: 'День A',
      dayPosition: 0,
      position: 0,
      setCount: 3,
      completed: true,
      notes: null,
      exercise: {
        id: 7,
        scope: 'global',
        name: 'Жим лёжа',
        description: null,
        tracking_type: 'weight_reps',
        category_code: 'chest',
        equipment_code: 'barbell',
        reference_source: null,
        reference_key: null,
        reference_media_url: null,
        is_favourite: false,
        can_edit: true,
      },
    },
    {
      programExerciseId: 102,
      dayId: 41,
      dayName: 'День A',
      dayPosition: 0,
      position: 1,
      setCount: 4,
      completed: false,
      notes: null,
      exercise: {
        id: 8,
        scope: 'global',
        name: 'Тяга верхнего блока',
        description: null,
        tracking_type: 'weight_reps',
        category_code: 'back',
        equipment_code: 'cable',
        reference_source: null,
        reference_key: null,
        reference_media_url: null,
        is_favourite: false,
        can_edit: true,
      },
    },
  ],
};

describe('ProgramPhaseCard', () => {
  it('renders exercises inside the phase using the exercise-card hierarchy', () => {
    const html = renderToStaticMarkup(<ProgramPhaseCard phase={phase} />);

    expect(html).toContain('Базовая фаза');
    expect(html).toContain('Активная');
    expect(html).toContain('1 / 2');
    expect(html).toContain('Жим лёжа');
    expect(html).toContain('День A · 3 подхода');
    expect(html).toContain('Тяга верхнего блока');
    expect(html).toContain('50% выполнено');
    expect(html).toContain('aria-valuenow="50"');
  });

  it('can start collapsed while preserving the accessible expansion state', () => {
    const html = renderToStaticMarkup(<ProgramPhaseCard phase={phase} defaultCollapsed />);

    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('hidden=""');
    expect(html).toContain('Развернуть фазу');
  });
});
