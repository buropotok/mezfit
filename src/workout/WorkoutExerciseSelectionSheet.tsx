import { useState } from 'react';
import { GlobalExerciseCatalog } from '../coach/GlobalExerciseCatalog';
import type { NavigationContext } from '../NavigationShell';
import { BottomSheet, FloatingActionButton, IconButton, Text } from '../ui';

interface WorkoutExerciseSelectionSheetProps {
  initData: string;
  saving: boolean;
  actionError?: string;
  onConfirm: (exerciseDefinitionIds: number[]) => void;
  onClose: () => void;
}

export function WorkoutExerciseSelectionSheet({
  initData,
  saving,
  actionError = '',
  onConfirm,
  onClose,
}: WorkoutExerciseSelectionSheetProps) {
  const [selectedIds, setSelectedIds] = useState<Set<number>>(() => new Set());
  const [navigationContext, setNavigationContext] = useState<NavigationContext | null>(null);

  const toggleExercise = (exerciseDefinitionId: number) => {
    if (saving) return;
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

  const floatingAction = selectedIds.size > 0 ? (
    <FloatingActionButton
      placement="right"
      label="Подтвердить выбор упражнений"
      disabled={saving}
      onClick={() => onConfirm([...selectedIds])}
    >
      ОК
    </FloatingActionButton>
  ) : undefined;

  return (
    <BottomSheet
      isOpen
      title={navigationContext?.title ?? 'Упражнения'}
      headerLeading={navigationContext ? (
        <IconButton label="Назад" disabled={saving} onClick={navigationContext.onBack}>
          <span aria-hidden="true">←</span>
        </IconButton>
      ) : undefined}
      floatingAction={floatingAction}
      hasCloseButton={!saving && navigationContext === null}
      closeOnBackdrop={!saving}
      modalColor
      onClose={close}
    >
      <div style={{ padding: '0 1.5rem 1.5rem' }}>
        {actionError ? <Text variant="footnote" tone="muted" role="alert">{actionError}</Text> : null}
        <GlobalExerciseCatalog
          initData={initData}
          mode="select"
          selectedExerciseIds={selectedIds}
          selectionDisabled={saving}
          onToggleExercise={toggleExercise}
          onNavigationContextChange={setNavigationContext}
        />
      </div>
    </BottomSheet>
  );
}
