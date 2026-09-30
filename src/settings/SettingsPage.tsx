import { useCallback, useEffect, useRef, useState } from 'react';
import type { NavigationContext } from '../NavigationShell';
import {
  getSelectionHapticBackend,
  getTelegramWebApp,
  runHapticProbe,
  type HapticProbeKind,
  type HapticProbeResult,
} from '../telegram';
import { Button, DatePicker, Surface, Text, TimePicker, type LocalDate, type LocalTime } from '../ui';
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
  const [timePickerOpen, setTimePickerOpen] = useState(false);
  const [timePickerValue, setTimePickerValue] = useState<LocalTime>('08:30');
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const [datePickerValue, setDatePickerValue] = useState<LocalDate>('2026-09-30');
  const [hapticProbe, setHapticProbe] = useState<{ kind: HapticProbeKind; result: HapticProbeResult } | null>(null);
  const timePickerTargetRef = useRef<HTMLSpanElement | null>(null);
  const telegramWebApp = getTelegramWebApp();
  const hapticBackend = getSelectionHapticBackend(telegramWebApp);
  const runProbe = (kind: HapticProbeKind) => {
    setHapticProbe({ kind, result: runHapticProbe(kind, telegramWebApp) });
  };
  const closeModules = useCallback(() => {
    setTimePickerOpen(false);
    setDatePickerOpen(false);
    setModulesOpen(false);
  }, []);

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

      <section className="modules-gallery__example" aria-labelledby="module-time-picker-title">
        <Text id="module-time-picker-title" variant="headline">Time picker</Text>
        <Text variant="footnote" tone="muted">
          Реальный UI Kit TimePicker с haptic feedback. Выбранное время: {timePickerValue}.
        </Text>
        <Text variant="caption" tone="muted">
          Haptic backend: {hapticBackend} · Telegram: {telegramWebApp?.platform ?? 'нет'} · version: {telegramWebApp?.version ?? 'нет'}
        </Text>
        <div className="modules-gallery__haptic-probes" aria-label="Проверка haptic feedback">
          <Button onClick={() => runProbe('telegram-selection')}>Selection</Button>
          <Button onClick={() => runProbe('telegram-light-impact')}>Impact light</Button>
          <Button onClick={() => runProbe('telegram-success-notification')}>Notification success</Button>
          <Button onClick={() => runProbe('browser-vibration')}>Vibrate 50 ms</Button>
        </div>
        <Text variant="caption" tone="muted">
          sent означает, что запрос отправлен API. Физическую вибрацию Telegram/WebView не подтверждает программно.
        </Text>
        {hapticProbe ? (
          <Text variant="caption" tone="muted">
            Probe: {hapticProbe.kind} → {hapticProbe.result}
          </Text>
        ) : null}
        <span ref={timePickerTargetRef} className="modules-gallery__trigger">
          <Button onClick={() => setTimePickerOpen(true)}>Выбрать время</Button>
        </span>
        {timePickerOpen && (
          <TimePicker
            opened
            target={timePickerTargetRef.current}
            value={timePickerValue}
            onChange={setTimePickerValue}
            onClose={() => setTimePickerOpen(false)}
          />
        )}
      </section>

      <section className="modules-gallery__example" aria-labelledby="module-date-picker-title">
        <Text id="module-date-picker-title" variant="headline">Date picker</Text>
        <Text variant="footnote" tone="muted">
          Реальный UI Kit DatePicker. Выбранная дата: {datePickerValue}.
        </Text>
        <span className="modules-gallery__trigger">
          <Button onClick={() => setDatePickerOpen(true)}>Выбрать дату</Button>
        </span>
        <DatePicker
          opened={datePickerOpen}
          value={datePickerValue}
          onChange={setDatePickerValue}
          onClose={() => setDatePickerOpen(false)}
        />
      </section>

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
