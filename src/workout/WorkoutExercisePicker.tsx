import { useEffect, useMemo, useState } from 'react';
import { getWorkoutExerciseOptions, type ExerciseCategoryCode, type ExerciseDefinition } from '../api';
import { ExerciseMedia } from '../ExerciseMedia';
import { exerciseDisplayName } from '../exerciseLocalization';
import { Button, FloatingActionButton, IconButton, List, ListItem, Menu, MenuItem, Modal, Text } from '../ui';
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
  const [exercises, setExercises] = useState<ExerciseDefinition[] | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(() => new Set());
  const [menuExerciseId, setMenuExerciseId] = useState<number | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isOpen || selectedCategory === null) return undefined;
    let cancelled = false;
    setExercises(null);

    getWorkoutExerciseOptions(initData, selectedCategory)
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

    return () => {
      cancelled = true;
    };
  }, [initData, isOpen, selectedCategory]);

  useEffect(() => {
    if (isOpen) return;
    setSelectedCategory(null);
    setExercises(null);
    setSelectedIds(new Set());
    setMenuExerciseId(null);
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
                    setMenuExerciseId(null);
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
                setExercises(null);
                setMenuExerciseId(null);
                setError('');
              }}
            >
              Назад к категориям
            </Button>
            {error ? <Text variant="footnote" tone="muted" role="alert">{error}</Text> : null}
            {exercises === null && !error ? <Text variant="footnote" tone="muted">Загружаем упражнения…</Text> : null}
            {exercises?.length === 0 && !error ? <Text variant="footnote" tone="muted">В этой категории пока нет упражнений.</Text> : null}
            {exercises && exercises.length > 0 ? (
              <List divider="inset">
                {exercises.map((exercise) => {
                  const selected = selectedIds.has(exercise.id);
                  const displayName = exerciseDisplayName(exercise);
                  return (
                    <ListItem
                      key={exercise.id}
                      leadingShape="square"
                      leading={<ExerciseMedia exercise={exercise} variant="thumbnail" />}
                      title={displayName}
                      subtitle={exercise.description ?? undefined}
                      trailing={selected ? <span className="workout-exercise-picker__selected-dot" aria-hidden="true" /> : undefined}
                      trailingAction={(
                        <Menu
                          isOpen={menuExerciseId === exercise.id}
                          onOpenChange={(open) => setMenuExerciseId(open ? exercise.id : null)}
                          align="end"
                          label={`Действия: ${displayName}`}
                          trigger={(
                            <IconButton label={`Действия: ${displayName}`} disabled={saving}>
                              <span aria-hidden="true">⋮</span>
                            </IconButton>
                          )}
                        >
                          <MenuItem onSelect={() => toggleExercise(exercise.id)}>
                            {selected ? 'Снять выбор' : 'Выбрать'}
                          </MenuItem>
                        </Menu>
                      )}
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
          ОК
        </FloatingActionButton>
      </div>
    </Modal>
  );
}
