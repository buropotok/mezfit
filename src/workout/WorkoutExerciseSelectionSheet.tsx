import { useCallback, useEffect, useMemo, useState } from 'react';
import { GlobalExerciseCatalog } from '../coach/GlobalExerciseCatalog';
import { useNavigationBackTransition, type NavigationContext } from '../NavigationShell';
import { BottomSheet, FloatingActionButton, IconButton, Text } from '../ui';

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
  const requestBackTransition = useNavigationBackTransition();
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
