import { useEffect, useState } from 'react';
import { getWorkoutExerciseOptions, type ExerciseDefinition } from '../api';
import { ExerciseMedia } from '../ExerciseMedia';
import { exerciseDisplayName } from '../exerciseLocalization';
import { List, ListItem, Modal, SearchInput, Text } from '../ui';

interface Props {
  initData: string;
  isOpen: boolean;
  addingExerciseId: number | null;
  actionError?: string;
  onAdd: (exerciseDefinitionId: number) => void;
  onClose: () => void;
}

export function WorkoutExercisePicker({ initData, isOpen, addingExerciseId, actionError = '', onAdd, onClose }: Props) {
  const [search, setSearch] = useState('');
  const [exercises, setExercises] = useState<ExerciseDefinition[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isOpen) return undefined;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      getWorkoutExerciseOptions(initData, search)
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
  }, [initData, isOpen, search]);

  useEffect(() => {
    if (!isOpen) {
      setSearch('');
      setExercises(null);
      setError('');
    }
  }, [isOpen]);

  return (
    <Modal
      isOpen={isOpen}
      title="Добавить упражнение"
      hasCloseButton={addingExerciseId === null}
      closeOnBackdrop={addingExerciseId === null}
      onClose={onClose}
    >
      <SearchInput
        aria-label="Поиск упражнения"
        placeholder="Поиск упражнения"
        value={search}
        onChange={(event) => setSearch(event.currentTarget.value)}
        onClear={() => setSearch('')}
        disabled={addingExerciseId !== null}
      />
      {actionError ? <Text variant="footnote" tone="muted" role="alert">{actionError}</Text> : null}
      {error ? <Text variant="footnote" tone="muted" role="alert">{error}</Text> : null}
      {exercises === null && !error ? <Text variant="footnote" tone="muted">Загружаем упражнения…</Text> : null}
      {exercises?.length === 0 && !error ? <Text variant="footnote" tone="muted">Ничего не найдено.</Text> : null}
      {exercises && exercises.length > 0 ? (
        <List divider="inset">
          {exercises.map((exercise) => (
            <ListItem
              key={exercise.id}
              leadingShape="square"
              leading={<ExerciseMedia exercise={exercise} variant="thumbnail" />}
              title={exerciseDisplayName(exercise)}
              subtitle={exercise.description ?? undefined}
              disabled={addingExerciseId !== null}
              onClick={() => onAdd(exercise.id)}
            />
          ))}
        </List>
      ) : null}
    </Modal>
  );
}
