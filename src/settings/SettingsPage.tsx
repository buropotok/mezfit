import { useCallback, useEffect, useRef, useState } from 'react';
import { Range, Toggle } from 'konsta/react';
import type { Role } from '../api';
import { MezfitExercisesSheet } from '../exercises';
import type { NavigationContext } from '../NavigationShell';
import {
  DEFAULT_GLASS_SETTINGS,
  GLASS_BLUR_MAX,
  GLASS_BLUR_MIN,
  GLASS_BLUR_STEP,
  GLASS_PRESET_NAMES,
  isGlassPresetName,
  resolveGlassPresetBlur,
  type GlassSettings,
} from '../glassSettings';
import {
  getSelectionHapticBackend,
  getTelegramWebApp,
  runHapticProbe,
  type HapticProbeKind,
  type HapticProbeResult,
} from '../telegram';
import {
  TYPOGRAPHY_FONT_STYLES,
  TYPOGRAPHY_ROLES,
  TYPOGRAPHY_ROLE_LABELS,
  TYPOGRAPHY_WEIGHTS,
  defaultTypographySettings,
  normalizeTypographySettings,
  type TypographyFontStyle,
  type TypographyPresetSettings,
  type TypographyRole,
  type TypographySettings,
} from '../typographySettings';
import { Button, DatePicker, Divider, Dropdown, GlassSurface, MezfitSidePanel, MezfitTopPanel, Surface, Text, TextInput, TimePicker, type DatePickerDayStatusEntry, type LocalDate, type LocalTime, type TimePickerLensMode } from '../ui';
import { SessionExercise, WorkoutSessionCard, type ActiveWorkoutSession, type SaveSessionSetInput, type SessionExerciseData, type SessionExerciseSetData, type WorkoutSessionCardMode } from '../workout';
import { LiquidPopoverModesDemo } from './LiquidPopoverModesDemo';
import './settings-page.css';

const datePickerStatusPreview: readonly DatePickerDayStatusEntry[] = [
  { date: '2026-09-27', status: 'scheduled' },
  { date: '2026-09-28', status: 'completed' },
  { date: '2026-09-29', status: 'missed' },
];

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

const workoutCardPreviewExercise: SessionExerciseData = {
  ...previewExercise,
  sessionExerciseId: -10,
  workoutSessionId: -900,
  exercise: {
    ...previewExercise.exercise,
    id: -10,
    name: 'Жим гантелей лёжа',
    equipment_code: 'dumbbell_pair',
  },
  sets: previewExercise.sets.map((set, index) => ({
    ...set,
    sessionSetId: -110 - index,
  })),
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
  initData?: string;
  activeRole?: Role;
  glassSettings?: Readonly<GlassSettings>;
  onGlassSettingsChange?: (settings: GlassSettings) => void;
  typographySettings?: Readonly<TypographySettings>;
  onTypographySettingsChange?: (settings: TypographySettings) => void;
  onNavigationContextChange: (context: NavigationContext | null) => void;
}

const glassPresetOptions = GLASS_PRESET_NAMES.map((preset) => ({ value: preset, label: preset }));
const typographyWeightOptions = TYPOGRAPHY_WEIGHTS.map((weight) => ({ value: String(weight), label: String(weight) }));
const typographyFontStyleOptions = [
  { value: 'normal', label: 'Обычное' },
  { value: 'italic', label: 'Курсив' },
] satisfies Array<{ value: TypographyFontStyle; label: string }>;

function updateTypographyPreset(
  settings: Readonly<TypographySettings>,
  role: TypographyRole,
  patch: Partial<TypographyPresetSettings>,
): TypographySettings {
  return normalizeTypographySettings({
    ...settings,
    [role]: {
      ...settings[role],
      ...patch,
    },
  });
}

type TypographyNumberFieldProps = {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onValueChange: (value: number) => void;
};

function TypographyNumberField({
  label,
  value,
  min,
  max,
  step,
  onValueChange,
}: TypographyNumberFieldProps) {
  const [draft, setDraft] = useState(String(value));

  useEffect(() => {
    setDraft(String(value));
  }, [value]);

  const commitIfComplete = (nextDraft: string): boolean => {
    const normalizedDraft = nextDraft.trim();
    if (
      normalizedDraft === ''
      || normalizedDraft === '-'
      || normalizedDraft === '+'
      || normalizedDraft.endsWith('.')
    ) {
      return false;
    }

    const nextValue = Number(normalizedDraft);
    if (!Number.isFinite(nextValue) || nextValue < min || nextValue > max) return false;
    onValueChange(nextValue);
    return true;
  };

  return (
    <TextInput
      type="number"
      label={label}
      min={min}
      max={max}
      step={step}
      showNumberControls={false}
      value={draft}
      onChange={(event) => {
        const nextDraft = event.currentTarget.value;
        setDraft(nextDraft);
        commitIfComplete(nextDraft);
      }}
      onBlur={() => {
        if (!commitIfComplete(draft)) setDraft(String(value));
      }}
    />
  );
}

export function SettingsPage({
  initData = '',
  activeRole = 'client',
  glassSettings = DEFAULT_GLASS_SETTINGS,
  onGlassSettingsChange = () => {},
  typographySettings = defaultTypographySettings(),
  onTypographySettingsChange = () => {},
  onNavigationContextChange,
}: SettingsPageProps) {
  const [modulesOpen, setModulesOpen] = useState(false);
  const [exercisesOpen, setExercisesOpen] = useState(false);
  const [glassSettingsOpen, setGlassSettingsOpen] = useState(false);
  const [typographySettingsOpen, setTypographySettingsOpen] = useState(false);
  const [timePickerOpen, setTimePickerOpen] = useState(false);
  const [timePickerValue, setTimePickerValue] = useState<LocalTime>('08:30');
  const [timePickerLensMode, setTimePickerLensMode] = useState<TimePickerLensMode>('auto');
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const [emptyDatePickerOpen, setEmptyDatePickerOpen] = useState(false);
  const [topPanelDemoOpen, setTopPanelDemoOpen] = useState(false);
  const [workoutCardMode, setWorkoutCardMode] = useState<WorkoutSessionCardMode>('active-program');
  const [workoutCardSource, setWorkoutCardSource] = useState<'program' | 'own'>('program');
  const [workoutCardExercises, setWorkoutCardExercises] = useState<SessionExerciseData[]>([workoutCardPreviewExercise]);
  const [workoutCardTitle, setWorkoutCardTitle] = useState('Своя тренировка');
  const [workoutCardComment, setWorkoutCardComment] = useState('После тренировки — лёгкая заминка 10 минут.');
  const [workoutCardActionMessage, setWorkoutCardActionMessage] = useState('');
  const workoutCardIdRef = useRef(-1000);
  const [datePickerValue, setDatePickerValue] = useState<LocalDate>('2026-09-30');
  const [hapticProbe, setHapticProbe] = useState<{ kind: HapticProbeKind; result: HapticProbeResult } | null>(null);
  const timePickerTargetRef = useRef<HTMLSpanElement | null>(null);
  const telegramWebApp = getTelegramWebApp();
  const hapticBackend = getSelectionHapticBackend(telegramWebApp);
  const effectiveGlassBlur = glassSettings.blur ?? resolveGlassPresetBlur(glassSettings.preset);
  const runProbe = (kind: HapticProbeKind) => {
    setHapticProbe({ kind, result: runHapticProbe(kind, telegramWebApp) });
  };
  const closeModules = useCallback(() => {
    setTimePickerOpen(false);
    setDatePickerOpen(false);
    setEmptyDatePickerOpen(false);
    setTopPanelDemoOpen(false);
    setModulesOpen(false);
  }, []);
  const closeExercises = useCallback(() => {
    setExercisesOpen(false);
  }, []);
  const closeGlassSettings = useCallback(() => {
    setGlassSettingsOpen(false);
  }, []);
  const closeTypographySettings = useCallback(() => {
    setTypographySettingsOpen(false);
  }, []);

  useEffect(() => {
    if (exercisesOpen) {
      onNavigationContextChange({
        title: 'Упражнения',
        scrollKey: 'settings:exercises',
        identity: { title: 'Упражнения', icon: 'barbell' },
        onBack: closeExercises,
      });
      return () => onNavigationContextChange(null);
    }

    if (typographySettingsOpen) {
      onNavigationContextChange({ title: 'Шрифты', scrollKey: 'settings:typography', onBack: closeTypographySettings });
      return () => onNavigationContextChange(null);
    }

    if (glassSettingsOpen) {
      onNavigationContextChange({ title: 'Настройки стекла', scrollKey: 'settings:glass', onBack: closeGlassSettings });
      return () => onNavigationContextChange(null);
    }

    if (modulesOpen) {
      onNavigationContextChange({ title: 'Модули', scrollKey: 'settings:modules', onBack: closeModules });
      return () => onNavigationContextChange(null);
    }

    onNavigationContextChange(null);
    return undefined;
  }, [
    closeExercises,
    closeGlassSettings,
    closeModules,
    closeTypographySettings,
    exercisesOpen,
    glassSettingsOpen,
    modulesOpen,
    onNavigationContextChange,
    typographySettingsOpen,
  ]);

  if (!modulesOpen && !glassSettingsOpen && !typographySettingsOpen) {
    return (
      <>
        <section className="settings-page" aria-label="Настройки">
          {activeRole === 'coach' ? (
            <Surface className="settings-page__section">
              <Text variant="title">Упражнения</Text>
              <Text variant="footnote" tone="muted">
                Каталог упражнений тренера, фильтры и пользовательские упражнения.
              </Text>
              <span className="settings-page__action">
                <Button onClick={() => setExercisesOpen(true)}>Открыть каталог</Button>
              </span>
            </Surface>
          ) : null}

          <Surface className="settings-page__section">
            <Text variant="title">Интерфейс</Text>
            <Text variant="footnote" tone="muted">
              Общие параметры материалов интерфейса.
            </Text>
            <div className="settings-page__actions">
              <Button onClick={() => setGlassSettingsOpen(true)}>Настройки стекла</Button>
              <Button variant="secondary" onClick={() => setTypographySettingsOpen(true)}>Шрифты</Button>
            </div>
          </Surface>

          <Surface className="settings-page__section">
            <Text variant="title">Разработка</Text>
            <Text variant="footnote" tone="muted">
              Временные инструменты для просмотра собранных интерфейсных модулей.
            </Text>
            <span className="settings-page__action">
              <Button onClick={() => setModulesOpen(true)}>Модули</Button>
            </span>
          </Surface>
        </section>

        {activeRole === 'coach' ? (
          <MezfitExercisesSheet
            opened={exercisesOpen}
            initData={initData}
            mode="manage"
            onClose={closeExercises}
          />
        ) : null}
      </>
    );
  }

  if (glassSettingsOpen) {
    const changeGlassPreset = (value: string) => {
      if (!isGlassPresetName(value)) return;
      onGlassSettingsChange({
        ...glassSettings,
        preset: value,
        blur: resolveGlassPresetBlur(value),
      });
    };

    return (
      <section className="settings-page" aria-label="Настройки стекла">
        <Surface className="settings-page__section">
          <Text variant="title">Настройки стекла</Text>
          <Text variant="footnote" tone="muted">
            Эти параметры применяются ко всем GlassSurface приложения. Локальные настройки компонента могут переопределить глобальное значение.
          </Text>

          <div className="settings-page__glass-field">
            <Text variant="footnote">Preset</Text>
            <Dropdown
              mode="single"
              value={glassSettings.preset}
              options={glassPresetOptions}
              title="Пресет GlassSurface"
              variant="field"
              onChange={changeGlassPreset}
            />
          </div>

          <div className="settings-page__glass-field">
            <label htmlFor="settings-glass-blur">
              <Text variant="footnote">Blur · {effectiveGlassBlur}px</Text>
            </label>
            <Range
              inputId="settings-glass-blur"
              min={GLASS_BLUR_MIN}
              max={GLASS_BLUR_MAX}
              step={GLASS_BLUR_STEP}
              value={effectiveGlassBlur}
              onChange={(event) => {
                const blur = Number(event.target.value);
                if (!Number.isFinite(blur)) return;
                onGlassSettingsChange({ ...glassSettings, blur });
              }}
            />
          </div>

          <label className="settings-page__glass-toggle">
            <span className="settings-page__glass-toggle-copy">
              <Text variant="body">Optics</Text>
              <Text variant="footnote" tone="muted">
                Включает оптическое преломление GlassSurface.
              </Text>
            </span>
            <Toggle
              component="span"
              checked={glassSettings.optics}
              onChange={() => onGlassSettingsChange({
                ...glassSettings,
                optics: !glassSettings.optics,
              })}
            />
          </label>
        </Surface>
      </section>
    );
  }

  if (typographySettingsOpen) {
    const setWeight = (role: TypographyRole, value: string) => {
      const weight = TYPOGRAPHY_WEIGHTS.find((candidate) => String(candidate) === value);
      if (weight === undefined) return;
      onTypographySettingsChange(updateTypographyPreset(typographySettings, role, { weight }));
    };
    const setFontStyle = (role: TypographyRole, value: string) => {
      const fontStyle = TYPOGRAPHY_FONT_STYLES.find((candidate) => candidate === value);
      if (fontStyle === undefined) return;
      onTypographySettingsChange(updateTypographyPreset(typographySettings, role, { fontStyle }));
    };

    return (
      <section className="settings-page" aria-label="Шрифты">
        <Surface className="settings-page__section">
          <Text variant="title">Шрифты</Text>
          <Text variant="footnote" tone="muted">
            Настройте шесть общих типографических пресетов. Изменения сразу применяются ко всему интерфейсу и сохраняются после перезагрузки.
          </Text>

          <div className="settings-page__typography-list">
            {TYPOGRAPHY_ROLES.map((role, index) => {
              const preset = typographySettings[role];
              return (
                <div key={role}>
                  <div className="settings-page__typography-preset">
                    <div className="settings-page__typography-preview">
                      <Text variant="footnote" tone="muted">{TYPOGRAPHY_ROLE_LABELS[role]}</Text>
                      <Text variant={role}>Пример текста</Text>
                    </div>

                    <div className="settings-page__typography-fields">
                      <TypographyNumberField
                        label="Размер, px"
                        min={8}
                        max={64}
                        step={1}
                        value={preset.size}
                        onValueChange={(size) => onTypographySettingsChange(
                          updateTypographyPreset(typographySettings, role, { size }),
                        )}
                      />
                      <TypographyNumberField
                        label="Межстрочный интервал, px"
                        min={8}
                        max={80}
                        step={1}
                        value={preset.lineHeight}
                        onValueChange={(lineHeight) => onTypographySettingsChange(
                          updateTypographyPreset(typographySettings, role, { lineHeight }),
                        )}
                      />
                      <TypographyNumberField
                        label="Межбуквенное, px"
                        min={-2}
                        max={4}
                        step={0.05}
                        value={preset.letterSpacing}
                        onValueChange={(letterSpacing) => onTypographySettingsChange(
                          updateTypographyPreset(typographySettings, role, { letterSpacing }),
                        )}
                      />
                      <div className="settings-page__typography-select">
                        <Text variant="footnote">Вес</Text>
                        <Dropdown
                          mode="single"
                          value={String(preset.weight)}
                          options={typographyWeightOptions}
                          title={`Вес · ${TYPOGRAPHY_ROLE_LABELS[role]}`}
                          variant="field"
                          onChange={(value) => setWeight(role, value)}
                        />
                      </div>
                      <div className="settings-page__typography-select">
                        <Text variant="footnote">Начертание</Text>
                        <Dropdown
                          mode="single"
                          value={preset.fontStyle}
                          options={typographyFontStyleOptions}
                          title={`Начертание · ${TYPOGRAPHY_ROLE_LABELS[role]}`}
                          variant="field"
                          onChange={(value) => setFontStyle(role, value)}
                        />
                      </div>
                    </div>
                  </div>
                  {index < TYPOGRAPHY_ROLES.length - 1 ? <Divider /> : null}
                </div>
              );
            })}
          </div>

          <span className="settings-page__action">
            <Button
              variant="secondary"
              onClick={() => onTypographySettingsChange(defaultTypographySettings())}
            >
              Сбросить шрифты
            </Button>
          </span>
        </Surface>
      </section>
    );
  }

  const workoutCardOwn = workoutCardMode === 'active-own'
    || (workoutCardMode === 'completed' && workoutCardSource === 'own');
  const workoutCardSession: ActiveWorkoutSession = {
    sessionId: -900,
    occurrenceId: null,
    status: workoutCardMode === 'completed' ? 'completed' : 'active',
    workoutDate: '2026-10-09',
    startedAt: '2026-10-09T18:05:00+03:00',
    completedAt: workoutCardMode === 'completed' ? '2026-10-09T19:12:00+03:00' : null,
    program: workoutCardOwn ? null : { id: -901, name: 'Силовой блок' },
    phase: workoutCardOwn ? null : { id: -902, name: 'Фаза 1' },
    day: workoutCardOwn ? null : { id: -903, name: 'День B', position: 1 },
    creator: {
      id: -904,
      firstName: 'Анна',
      lastName: 'Тренер',
      username: 'anna',
      photoUrl: null,
    },
    exercises: workoutCardExercises,
  };

  const reorderWorkoutCardExercises = (ids: number[]) => {
    const byId = new Map(workoutCardExercises.map((exercise) => [exercise.sessionExerciseId, exercise]));
    setWorkoutCardExercises(ids.flatMap((id, position) => {
      const exercise = byId.get(id);
      return exercise ? [{ ...exercise, position }] : [];
    }));
  };

  const addWorkoutCardSet = (sessionExerciseId: number) => {
    setWorkoutCardExercises((current) => current.map((exercise) => {
      if (exercise.sessionExerciseId !== sessionExerciseId) return exercise;
      const nextPosition = exercise.sets.reduce(
        (maxPosition, set) => Math.max(maxPosition, set.position),
        -1,
      ) + 1;
      const nextId = workoutCardIdRef.current--;
      return {
        ...exercise,
        sets: [...exercise.sets, {
          sessionSetId: nextId,
          sourceProgramSetId: null,
          position: nextPosition,
          status: 'pending',
          plan: null,
          previous: null,
          fact: null,
        }],
      };
    }));
  };

  const addWorkoutCardExercise = () => {
    const nextId = workoutCardIdRef.current--;
    setWorkoutCardExercises((current) => [
      ...current,
      {
        ...workoutCardPreviewExercise,
        sessionExerciseId: nextId,
        workoutSessionId: -900,
        position: current.length,
        exercise: {
          ...workoutCardPreviewExercise.exercise,
          id: nextId,
          name: `Дополнительное упражнение ${current.length + 1}`,
        },
        sets: [],
      },
    ]);
  };

  const saveWorkoutCardSet = async (input: SaveSessionSetInput) => {
    setWorkoutCardExercises((current) => current.map((exercise) => {
      if (exercise.sessionExerciseId !== input.sessionExerciseId) return exercise;
      return {
        ...exercise,
        sets: exercise.sets.map((set) => set.sessionSetId === input.sessionSetId
          ? { ...set, status: 'completed' as const, fact: input.fact }
          : set),
      };
    }));
  };

  return (
    <section className="settings-page modules-gallery" aria-label="Примеры модулей">
      <div className="modules-gallery__intro">
        <Text variant="title">Собранные модули</Text>
        <Text variant="footnote" tone="muted">
          Здесь отображаются реальные React-компоненты приложения на демонстрационных данных.
        </Text>
      </div>

      <section className="modules-gallery__example" aria-labelledby="module-workout-card-title">
        <Text id="module-workout-card-title" variant="headline">Карточка тренировки</Text>
        <Text variant="footnote" tone="muted">
          Реальный WorkoutSessionCard: SortableList/DnD, SessionExercise, LiquidPopover и MezfitDialog.
        </Text>
        <div className="modules-gallery__trigger">
          <Button
            variant="secondary"
            selected={workoutCardMode === 'active-program'}
            onClick={() => {
              setWorkoutCardSource('program');
              setWorkoutCardMode('active-program');
            }}
          >
            Active · Program
          </Button>
          <Button
            variant="secondary"
            selected={workoutCardMode === 'active-own'}
            onClick={() => {
              setWorkoutCardSource('own');
              setWorkoutCardMode('active-own');
            }}
          >
            Active · Own
          </Button>
          <Button
            variant="secondary"
            selected={workoutCardMode === 'completed'}
            onClick={() => setWorkoutCardMode('completed')}
          >
            Completed
          </Button>
        </div>
        <WorkoutSessionCard
          session={workoutCardSession}
          title={workoutCardOwn ? workoutCardTitle : undefined}
          comment={workoutCardComment}
          onReorderExerciseIds={reorderWorkoutCardExercises}
          onSaveSet={saveWorkoutCardSet}
          onAddSet={addWorkoutCardSet}
          onAddExercise={addWorkoutCardExercise}
          onRename={(title) => setWorkoutCardTitle(title)}
          onTransfer={() => setWorkoutCardActionMessage('Передать тренировку')}
          onEditResults={() => setWorkoutCardActionMessage('Редактировать результаты')}
          onWorkoutHistory={() => setWorkoutCardActionMessage('История')}
          onShare={() => setWorkoutCardActionMessage('Поделиться')}
          onCommentChange={(comment) => setWorkoutCardComment(comment)}
        />
        {workoutCardActionMessage ? (
          <Text variant="footnote" tone="muted">{workoutCardActionMessage}</Text>
        ) : null}
        <span className="settings-page__action">
          <GlassSurface
            component="button"
            wrapContent={false}
            shape="capsule"
            className="modules-gallery__workout-lifecycle"
            onClick={() => {
              if (workoutCardMode === 'completed') {
                setWorkoutCardMode(workoutCardSource === 'own' ? 'active-own' : 'active-program');
                return;
              }
              setWorkoutCardSource(workoutCardMode === 'active-own' ? 'own' : 'program');
              setWorkoutCardMode('completed');
            }}
          >
            <Text variant="body">
              {workoutCardMode === 'completed' ? 'Возобновить тренировку' : 'Завершить тренировку'}
            </Text>
          </GlassSurface>
        </span>
      </section>

      <LiquidPopoverModesDemo />

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
        <Text variant="caption" tone="muted">
          Lens mode: {timePickerLensMode}. Auto переключается на iOS scale-режим на iPhone/iPad.
        </Text>
        <span ref={timePickerTargetRef} className="modules-gallery__trigger">
          <Button onClick={() => {
            setTimePickerLensMode('auto');
            setTimePickerOpen(true);
          }}>Выбрать время</Button>
          <Button variant="secondary" onClick={() => {
            setTimePickerLensMode('ios');
            setTimePickerOpen(true);
          }}>iOS mode</Button>
        </span>
        <TimePicker
          opened={timePickerOpen}
          lensMode={timePickerLensMode}
          target={timePickerTargetRef.current}
          value={timePickerValue}
          onChange={setTimePickerValue}
          onClose={() => setTimePickerOpen(false)}
        />
      </section>

      <section className="modules-gallery__example" aria-labelledby="module-date-picker-title">
        <Text id="module-date-picker-title" variant="headline">Date picker</Text>
        <Text variant="footnote" tone="muted">
          Реальный UI Kit DatePicker. Выбранная дата: {datePickerValue}.
        </Text>
        <span className="modules-gallery__trigger">
          <Button onClick={() => setDatePickerOpen((open) => !open)}>Выбрать дату</Button>
          <Button variant="secondary" onClick={() => setEmptyDatePickerOpen(true)}>Открыть пустой</Button>
        </span>
        <DatePicker
          opened={datePickerOpen}
          surface="top-panel"
          value={datePickerValue}
          onChange={setDatePickerValue}
          onClose={() => setDatePickerOpen(false)}
          glassPreset={glassSettings.preset}
          glassOptics={glassSettings.optics}
          dayStatuses={datePickerStatusPreview}
        />
        <MezfitSidePanel
          side="right"
          opened={emptyDatePickerOpen}
          floating
          backdrop
          onBackdropClick={() => setEmptyDatePickerOpen(false)}
          role="dialog"
          aria-modal="true"
          aria-label="Пустой Date picker"
        />
      </section>

      <section className="modules-gallery__example" aria-labelledby="module-top-panel-title">
        <Text id="module-top-panel-title" variant="headline">Mezfit top panel</Text>
        <Text variant="footnote" tone="muted">
          Базовый UI Kit компонент: выезжает ниже navbar, не закрывается по нажатию снаружи и поддерживает swipe вверх.
        </Text>
        <span className="modules-gallery__trigger">
          <Button onClick={() => setTopPanelDemoOpen(true)}>Открыть Top Panel</Button>
        </span>
        <MezfitTopPanel
          opened={topPanelDemoOpen}
          onClose={() => setTopPanelDemoOpen(false)}
          role="dialog"
          aria-label="Mezfit Top Panel demo"
        >
          <div className="modules-gallery__top-panel-demo">
            <Text variant="headline">Mezfit top panel</Text>
            <Text variant="body">
              Демонстрация базовой панели без DatePicker. Закройте её кнопкой или свайпом вверх.
            </Text>
            <span className="modules-gallery__trigger">
              <Button variant="secondary" onClick={() => setTopPanelDemoOpen(false)}>Закрыть</Button>
            </span>
          </div>
        </MezfitTopPanel>
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
