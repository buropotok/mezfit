import { useEffect, useMemo, useState } from 'react';
import { getWorkoutExerciseOptions, type ExerciseCategoryCode, type ExerciseDefinition } from '../api';
import { ExerciseMedia } from '../ExerciseMedia';
import { exerciseDisplayName } from '../exerciseLocalization';
import { Button, FloatingActionButton, List, ListItem, Modal, SearchInput, Text } from '../ui';
import './workout-exercise-picker.css';

const categoryOptions: Array<{ code: ExerciseCategoryCode; label: string }> = [
  { code: 'chest', label: 'Грудь' },
  { code: 'arms', label: 'Руки' },
  { code: 'back', label: 'Спина' },
  { code: 'legs', label: 'Ноги' },
  { code: 'shoulders', label: 'Плечи' },
  { code: 'core', label: 'Корпус' },
  { code: 'full_body', label: 'Фулбоди' },
  { code: 'cardio', label: 'Кардио' },
  { code: 'other', label: 'Другое' },
];

interface Props {
  initData: string;
  isOpen: boolean;
  saving: boolean;
  actionError?: string;
  onConfirm: (exerciseDefinitionIds: number[]) => void;
  onClose: () => void;
}

export function WorkoutExercisePicker({ initData, isOpen, saving, actionError = '', onConfirm, onClose }: Props) {
  const [selectedCategory, setSelectedCategory] = useState<ExerciseCategoryCode | null>(null);
  const [search, setSearch] = useState('');
  const [exercises, setExercises] = useState<ExerciseDefinition[] | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(() => new Set());
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isOpen || selectedCategory === null) return undefined;
    let cancelled = false;
    setExercises(null);
    const timer = window.setTimeout(() => {
      getWorkoutExerciseOptions(initData, selectedCategory, search)
        .then(({ exercises: nextExercises }) => {
          if (cancelled) return;
          setExercises(nextExercises);
          setError('');
        })
        .catch((reason: unknown) => {
          if (cancelled) return;
          setExercises([]);
          setError(reason instanceof Error ? reason.message : 'Не удалось загрузить упражнения');
        });
    }, 150);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [initData, isOpen, search, selectedCategory]);

  useEffect(() => {
    if (isOpen) return;
    setSelectedCategory(null);
    setSearch('');
    setExercises(null);
    setSelectedIds(new Set());
    setError('');
  }, [isOpen]);

  const selectedCount = selectedIds.size;
  const selectedCategoryLabel = useMemo(
    () => categoryOptions.find((category) => category.code === selectedCategory)?.label ?? 'Упражнения',
    [selectedCategory],
  );

  const toggleExercise = (exerciseDefinitionId: number) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(exerciseDefinitionId)) next.delete(exerciseDefinitionId);
      else next.add(exerciseDefinitionId);
      return next;
    });
  };

  const close = () => {
    if (!saving) onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      title={selectedCategory === null ? 'Упражнения' : selectedCategoryLabel}
      hasCloseButton={!saving}
      closeOnBackdrop={!saving}
      onClose={close}
    >
      <div className="workout-exercise-picker">
        {actionError ? <Text variant="footnote" tone="muted" role="alert">{actionError}</Text> : null}
        {selectedCategory === null ? (
          <>
            {selectedCount > 0 ? <Text variant="footnote" tone="muted">Выбрано: {selectedCount}</Text> : null}
            <List divider="inset">
              {categoryOptions.map((category) => (
                <ListItem
                  key={category.code}
                  title={category.label}
                  disabled={saving}
                  onClick={() => {
                    setSelectedCategory(category.code);
                    setSearch('');
                    setError('');
                  }}
                />
              ))}
            </List>
          </>
        ) : (
          <>
            <Button
              variant="secondary"
              disabled={saving}
              onClick={() => {
                setSelectedCategory(null);
                setSearch('');
                setExercises(null);
                setError('');
              }}
            >
              Назад к категориям
            </Button>
            <SearchInput
              aria-label="Поиск упражнения"
              placeholder="Поиск упражнения"
              value={search}
              onChange={(event) => setSearch(event.currentTarget.value)}
              onClear={() => setSearch('')}
              disabled={saving}
            />
            {error ? <Text variant="footnote" tone="muted" role="alert">{error}</Text> : null}
            {exercises === null && !error ? <Text variant="footnote" tone="muted">Загружаем упражнения…</Text> : null}
            {exercises?.length === 0 && !error ? <Text variant="footnote" tone="muted">Ничего не найдено.</Text> : null}
            {exercises && exercises.length > 0 ? (
              <List divider="inset">
                {exercises.map((exercise) => {
                  const selected = selectedIds.has(exercise.id);
                  return (
                    <ListItem
                      key={exercise.id}
                      leadingShape="square"
                      leading={<ExerciseMedia exercise={exercise} variant="thumbnail" />}
                      title={exerciseDisplayName(exercise)}
                      subtitle={exercise.description ?? undefined}
                      trailing={selected ? <span className="workout-exercise-picker__selected-dot" aria-hidden="true" /> : undefined}
                      aria-pressed={selected}
                      disabled={saving}
                      onClick={() => toggleExercise(exercise.id)}
                    />
                  );
                })}
              </List>
            ) : null}
          </>
        )}
        <FloatingActionButton
          placement="right"
          label="Добавить выбранные упражнения"
          isShown={selectedCount > 0}
          disabled={saving}
          onClick={() => onConfirm([...selectedIds])}
        >
          <Text variant="body">ОК</Text>
        </FloatingActionButton>
      </div>
    </Modal>
  );
}
