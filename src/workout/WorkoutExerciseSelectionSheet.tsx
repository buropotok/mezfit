import { useCallback, useEffect, useMemo, useState } from 'react';
import { PublicExercises } from '../exercises/PublicExercises';
import { useNavigationBackTransition, type NavigationContext } from '../NavigationShell';
import { BottomSheet, FloatingActionButton, IconButton, Text } from '../ui';

interface WorkoutExerciseSelectionSheetProps {
  saving: boolean;
  actionError?: string;
  onConfirm: (exerciseIds: string[]) => void;
  onClose: () => void;
  onNavigationContextChange?: (context: NavigationContext | null) => void;
}

export function WorkoutExerciseSelectionSheet({
  saving,
  actionError = '',
  onConfirm,
  onClose,
  onNavigationContextChange,
}: WorkoutExerciseSelectionSheetProps) {
  const requestBackTransition = useNavigationBackTransition();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [navigationContext, setNavigationContext] = useState<NavigationContext | null>(null);

  const toggleExercise = (exerciseId: string) => {
    if (saving) return;
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(exerciseId)) next.delete(exerciseId);
      else next.add(exerciseId);
      return next;
    });
  };

  const close = useCallback(() => {
    if (!saving) onClose();
  }, [onClose, saving]);

  const requestBack = useCallback(() => {
    if (saving) return;
    if (navigationContext?.onBack) requestBackTransition(navigationContext.onBack);
    else onClose();
  }, [navigationContext, onClose, requestBackTransition, saving]);

  const externalNavigationTitle = navigationContext?.title ?? 'Упражнения';
  const externalNavigationScrollKey = navigationContext?.scrollKey ?? 'root';
  const externalNavigationContext = useMemo<NavigationContext>(() => ({
    title: externalNavigationTitle,
    scrollKey: `workout-exercise-selection:${externalNavigationScrollKey}`,
    identity: { title: externalNavigationTitle, icon: 'barbell' },
    onBack: requestBack,
  }), [externalNavigationScrollKey, externalNavigationTitle, requestBack]);

  useEffect(() => {
    onNavigationContextChange?.(externalNavigationContext);
  }, [externalNavigationContext, onNavigationContextChange]);

  useEffect(() => () => {
    onNavigationContextChange?.(null);
  }, [onNavigationContextChange]);

  const floatingAction = selectedIds.size > 0 ? (
    <FloatingActionButton
      placement="right"
      label="Добавить выбранные упражнения"
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
        <IconButton label="Назад" disabled={saving} onClick={requestBack}>
          <span aria-hidden="true">←</span>
        </IconButton>
      ) : undefined}
      floatingAction={floatingAction}
      hasCloseButton={!saving && navigationContext === null}
      closeOnBackdrop={!saving}
      modalColor
      inset
      onClose={close}
    >
      <div style={{ padding: '0 1.5rem 1.5rem' }}>
        {actionError ? <Text variant="footnote" tone="muted" role="alert">{actionError}</Text> : null}
        <PublicExercises
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
