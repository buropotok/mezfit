import { describe, expect, it, vi } from 'vitest';
import { getCoachProgramDetails } from './program-details';

describe('getCoachProgramDetails', () => {
  it('groups phases and exercises and derives current completion progress', async () => {
    const prepare = vi.fn((sql: string) => {
      if (sql.includes('FROM training_plan tp')) {
        return {
          bind: vi.fn(() => ({
            first: vi.fn().mockResolvedValue({
              id: 5,
              user_id: 7,
              owner_coach_user_id: 3,
              created_by_user_id: 3,
              name: 'Силовой цикл',
              status: 'active',
              started_at: '2026-09-01T09:00:00Z',
              finished_at: null,
              position: 0,
            }),
          })),
        };
      }

      if (sql.includes('FROM app_user')) {
        return {
          bind: vi.fn(() => ({
            first: vi.fn().mockResolvedValue({
              id: 7,
              first_name: 'Анна',
              last_name: 'Иванова',
              username: 'anna',
              photo_url: null,
            }),
          })),
        };
      }

      if (sql.includes('FROM program_phase phase')) {
        return {
          bind: vi.fn(() => ({
            all: vi.fn().mockResolvedValue({
              results: [
                {
                  phase_id: 10,
                  phase_name: 'Адаптация',
                  phase_position: 0,
                  phase_status: 'finished',
                  phase_planned_start_date: '2026-09-01',
                  phase_planned_end_date: '2026-09-07',
                  phase_started_at: '2026-09-01T09:00:00Z',
                  phase_finished_at: '2026-09-07T10:00:00Z',
                  day_id: 21,
                  day_name: 'День 1',
                  day_position: 0,
                  program_exercise_id: 101,
                  exercise_position: 0,
                  exercise_notes: null,
                  exercise_id: 201,
                  exercise_scope: 'global',
                  exercise_name: 'Приседания',
                  exercise_description: null,
                  exercise_tracking_type: 'weight_reps',
                  exercise_category_code: 'legs',
                  exercise_equipment_code: 'barbell',
                  exercise_reference_source: null,
                  exercise_reference_key: null,
                  exercise_reference_media_url: null,
                  exercise_is_favourite: 0,
                  exercise_can_edit: 1,
                  set_count: 3,
                  completed: 0,
                },
                {
                  phase_id: 11,
                  phase_name: 'Основная',
                  phase_position: 1,
                  phase_status: 'active',
                  phase_planned_start_date: '2026-09-08',
                  phase_planned_end_date: '2026-10-05',
                  phase_started_at: '2026-09-08T09:00:00Z',
                  phase_finished_at: null,
                  day_id: 22,
                  day_name: 'День A',
                  day_position: 0,
                  program_exercise_id: 102,
                  exercise_position: 0,
                  exercise_notes: null,
                  exercise_id: 202,
                  exercise_scope: 'global',
                  exercise_name: 'Жим лёжа',
                  exercise_description: null,
                  exercise_tracking_type: 'weight_reps',
                  exercise_category_code: 'chest',
                  exercise_equipment_code: 'barbell',
                  exercise_reference_source: null,
                  exercise_reference_key: null,
                  exercise_reference_media_url: null,
                  exercise_is_favourite: 1,
                  exercise_can_edit: 1,
                  set_count: 4,
                  completed: 1,
                },
                {
                  phase_id: 11,
                  phase_name: 'Основная',
                  phase_position: 1,
                  phase_status: 'active',
                  phase_planned_start_date: '2026-09-08',
                  phase_planned_end_date: '2026-10-05',
                  phase_started_at: '2026-09-08T09:00:00Z',
                  phase_finished_at: null,
                  day_id: 22,
                  day_name: 'День A',
                  day_position: 0,
                  program_exercise_id: 103,
                  exercise_position: 1,
                  exercise_notes: 'Не спешить',
                  exercise_id: 203,
                  exercise_scope: 'global',
                  exercise_name: 'Тяга верхнего блока',
                  exercise_description: null,
                  exercise_tracking_type: 'weight_reps',
                  exercise_category_code: 'back',
                  exercise_equipment_code: 'cable',
                  exercise_reference_source: null,
                  exercise_reference_key: null,
                  exercise_reference_media_url: null,
                  exercise_is_favourite: 0,
                  exercise_can_edit: 1,
                  set_count: 3,
                  completed: 0,
                },
              ],
            }),
          })),
        };
      }

      throw new Error(`Unexpected SQL: ${sql}`);
    });

    const db = { prepare } as unknown as D1Database;
    const details = await getCoachProgramDetails(db, 5, 3);

    expect(details?.ownerType).toBe('client');
    expect(details?.owner).toMatchObject({ id: 7, firstName: 'Анна', lastName: 'Иванова' });
    expect(details?.plannedStartDate).toBe('2026-09-01');
    expect(details?.plannedEndDate).toBe('2026-10-05');
    expect(details?.exerciseCount).toBe(3);
    expect(details?.completedExerciseCount).toBe(2);
    expect(details?.progressPercent).toBe(67);
    expect(details?.phases).toHaveLength(2);
    expect(details?.phases[0]).toMatchObject({ completedExerciseCount: 1, exerciseCount: 1, progressPercent: 100 });
    expect(details?.phases[1]).toMatchObject({ completedExerciseCount: 1, exerciseCount: 2, progressPercent: 50 });
    expect(details?.phases[1].exercises[0]).toMatchObject({
      dayName: 'День A',
      setCount: 4,
      completed: true,
      exercise: { id: 202, name: 'Жим лёжа', is_favourite: true },
    });
    expect(prepare.mock.calls.some(([sql]) => sql.includes('exercise_definition_override'))).toBe(true);
    expect(prepare.mock.calls.some(([sql]) => sql.includes('source_program_exercise_id'))).toBe(true);
  });
});
