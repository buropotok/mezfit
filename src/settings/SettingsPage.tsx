import { useCallback, useEffect, useState } from 'react';
import type { NavigationContext } from '../NavigationShell';
import { Button, Surface, Text } from '../ui';
import { SessionExercise, type SessionExerciseData, type SessionExerciseSetData } from '../workout';
import './settings-page.css';

const previewExercise: SessionExerciseData = {
  sessionExerciseId: -1,
  workoutSessionId: -1,
  sourceProgramExerciseId: null,
  position: 0,
  status: 'active',
  notes: 'Контрольный пример модуля с планом, предыдущим результатом и заполненным подходом.',
  exercise: {
    id: -1,
    scope: 'global',
    name: 'Жим штанги лёжа',
    description: null,
    tracking_type: 'weight_reps',
    category_code: 'chest',
    equipment_code: 'barbell',
    reference_source: null,
    reference_key: null,
    reference_media_url: null,
    is_favourite: false,
    can_edit: false,
  },
  sets: [
    {
      sessionSetId: -101,
      sourceProgramSetId: null,
      position: 0,
      status: 'completed',
      plan: { weightKg: 80, reps: 8, durationSeconds: null, distanceMeters: null },
      previous: {
        workoutDate: '2026-09-09',
        metrics: { weightKg: 77.5, reps: 8, durationSeconds: null, distanceMeters: null },
      },
      fact: {
        metrics: { weightKg: 80, reps: 8, durationSeconds: null, distanceMeters: null },
        setLabel: 'normal',
        rpe: 8,
        comment: null,
        bands: [],
      },
    },
    {
      sessionSetId: -102,
      sourceProgramSetId: null,
      position: 1,
      status: 'pending',
      plan: { weightKg: 80, reps: 8, durationSeconds: null, distanceMeters: null },
      previous: {
        workoutDate: '2026-09-09',
        metrics: { weightKg: 77.5, reps: 7, durationSeconds: null, distanceMeters: null },
      },
      fact: null,
    },
    {
      sessionSetId: -103,
      sourceProgramSetId: null,
      position: 2,
      status: 'pending',
      plan: { weightKg: 80, reps: 8, durationSeconds: null, distanceMeters: null },
      previous: null,
      fact: null,
    },
  ],
};

const planCreateSet: SessionExerciseSetData = {
  sessionSetId: -204,
  sourceProgramSetId: null,
  position: 2,
  status: 'pending',
  plan: null,
  previous: {
    workoutDate: '2026-09-09',
    metrics: { weightKg: 77.5, reps: 7, durationSeconds: null, distanceMeters: null },
  },
  fact: null,
};

const planPreviewExercise: SessionExerciseData = {
  ...previewExercise,
  sessionExerciseId: -2,
  sourceProgramExerciseId: -2,
  status: 'planned',
  exercise: { ...previewExercise.exercise, id: -2, name: 'Приседания со штангой', category_code: 'legs' },
  notes: 'Демонстрация плана тренера: сохранённые подходы и отдельная строка добавления.',
  sets: previewExercise.sets.slice(0, 2).map((set) => ({
    ...set,
    sessionSetId: set.sessionSetId - 100,
    sourceProgramSetId: set.sessionSetId - 100,
    status: 'pending',
    fact: null,
  })),
};

interface SettingsPageProps {
  onNavigationContextChange: (context: NavigationContext | null) => void;
}

export function SettingsPage({ onNavigationContextChange }: SettingsPageProps) {
  const [modulesOpen, setModulesOpen] = useState(false);
  const closeModules = useCallback(() => setModulesOpen(false), []);

  useEffect(() => {
    if (!modulesOpen) {
      onNavigationContextChange(null);
      return undefined;
    }

    onNavigationContextChange({ title: 'Модули', onBack: closeModules });
    return () => onNavigationContextChange(null);
  }, [closeModules, modulesOpen, onNavigationContextChange]);

  if (!modulesOpen) {
    return (
      <section className="settings-page" aria-label="Настройки">
        <Surface className="settings-page__section">
          <Text variant="title">Разработка</Text>
          <Text variant="footnote" tone="muted">
            Временные инструменты для просмотра собранных интерфейсных модулей.
          </Text>
          <Button onClick={() => setModulesOpen(true)}>Модули</Button>
        </Surface>
      </section>
    );
  }

  return (
    <section className="settings-page modules-gallery" aria-label="Примеры модулей">
      <div className="modules-gallery__intro">
        <Text variant="title">Собранные модули</Text>
        <Text variant="footnote" tone="muted">
          Здесь отображаются реальные React-компоненты приложения на демонстрационных данных.
        </Text>
      </div>

      <section className="modules-gallery__example" aria-labelledby="module-session-exercise-title">
        <Text id="module-session-exercise-title" variant="headline">Карточка упражнения и подходов</Text>
        <Text variant="footnote" tone="muted">
          Режим workout. Нажатие на строку подхода открывает настоящий модуль ввода результата подхода.
        </Text>
        <SessionExercise
          mode="workout"
          context={{ workoutSessionId: -1, workoutDate: '2026-09-16', program: { id: -1, name: 'Пример программы' } }}
          data={previewExercise}
          onSaveSet={async () => {}}
          onOpenExerciseMenu={() => {}}
          onOpenHistory={() => {}}
          onOpenChat={() => {}}
        />
      </section>

      <section className="modules-gallery__example" aria-labelledby="module-plan-exercise-title">
        <Text id="module-plan-exercise-title" variant="headline">Карточка упражнения и подходов · plan</Text>
        <Text variant="footnote" tone="muted">
          Откройте «Подход 3», чтобы посмотреть ввод плана с предыдущей тренировкой без оценки и RPE. Данные вымышленные: сохранение в этом примере недоступно.
        </Text>
        <SessionExercise
          mode="plan"
          programExerciseId={-2}
          createSet={planCreateSet}
          context={{ workoutSessionId: -1, workoutDate: '2026-09-16', program: { id: -1, name: 'Пример программы' } }}
          data={planPreviewExercise}
          onPlanSetSaved={() => {}}
          onOpenExerciseMenu={() => {}}
          onOpenHistory={() => {}}
          onOpenChat={() => {}}
        />
      </section>
    </section>
  );
}
