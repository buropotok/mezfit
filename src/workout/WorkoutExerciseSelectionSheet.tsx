import { useEffect, useState } from 'react';
import { MezfitExercisesSheet } from '../exercises';
import type { NavigationContext } from '../NavigationShell';
import { Button, Text } from '../ui';

interface WorkoutExerciseSelectionSheetProps {
  initData: string;
  saving: boolean;
  actionError?: string;
  onConfirm: (exerciseDefinitionIds: number[]) => void;
  onClose: () => void;
  onNavigationContextChange?: (context: NavigationContext | null) => void;
}

export function WorkoutExerciseSelectionSheet({
  initData,
  saving,
  actionError = '',
  onConfirm,
  onClose,
  onNavigationContextChange,
}: WorkoutExerciseSelectionSheetProps) {
  const [selectedIds, setSelectedIds] = useState<Set<number>>(() => new Set());

  useEffect(() => {
    onNavigationContextChange?.({
      title: 'Упражнения',
      scrollKey: 'workout-exercise-selection',
      identity: { title: 'Упражнения', icon: 'barbell' },
      onBack: onClose,
    });
    return () => onNavigationContextChange?.(null);
  }, [onClose, onNavigationContextChange]);

  const toggleExercise = (exerciseDefinitionId: number) => {
    if (saving) return;
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(exerciseDefinitionId)) next.delete(exerciseDefinitionId);
      else next.add(exerciseDefinitionId);
      return next;
    });
  };

  return (
    <MezfitExercisesSheet
      opened
      initData={initData}
      mode="select"
      selectedExerciseIds={selectedIds}
      selectionDisabled={saving}
      onToggleExercise={toggleExercise}
      onClose={() => {
        if (!saving) onClose();
      }}
      notice={actionError ? (
        <Text variant="footnote" role="alert" className="mezfit-exercises__error">
          {actionError}
        </Text>
      ) : undefined}
      footer={selectedIds.size > 0 ? (
        <Button
          aria-label="Добавить выбранные упражнения"
          disabled={saving}
          onClick={() => onConfirm([...selectedIds])}
        >
          {saving ? 'Добавляем…' : `Добавить выбранные · ${selectedIds.size}`}
        </Button>
      ) : undefined}
    />
  );
}
