import { useCallback, useEffect, useMemo, useState } from 'react';
import { PersonalExercises } from '../exercises/PersonalExercises';
import { PublicExercises } from '../exercises/PublicExercises';
import { useNavigationBackTransition, type NavigationContext } from '../NavigationShell';
import { Button, IconButton, MezfitBottomSheet, Text } from '../ui';
import './workout-exercise-selection.css';

interface WorkoutExerciseSelectionSheetProps {
  initData: string;
  personalCatalogueRole?: 'coach' | 'client';
  opened?: boolean;
  saving: boolean;
  actionError?: string;
  onConfirm: (exerciseIds: string[]) => void;
  onClose: () => void;
  onClosed?: () => void;
  onNavigationContextChange?: (context: NavigationContext | null) => void;
}

/**
 * One shared Dexie Cloud catalogue for browsing and selecting.
 * The caller owns persistence; PLAN and FACT keep separate typed operations.
 */
export function WorkoutExerciseSelectionSheet(props: WorkoutExerciseSelectionSheetProps) {
  return <MezfitBottomSheet opened={props.opened ?? true} label="Выбор упражнений для тренировки"
    lazyMount onClosed={props.onClosed}>
    <WorkoutExerciseSelectionContent {...props} />
  </MezfitBottomSheet>;
}

/** Selection/navigation subscriptions exist only while the sheet content is mounted. */
function WorkoutExerciseSelectionContent({
  opened = true, personalCatalogueRole,
  saving,
  actionError = '',
  onConfirm,
  onClose,
  onNavigationContextChange,
}: WorkoutExerciseSelectionSheetProps) {
  const requestBackTransition = useNavigationBackTransition();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [navigationContext, setNavigationContext] = useState<NavigationContext | null>(null);

  const toggleExercise = useCallback((id: string) => {
    if (saving) return;
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else if (next.size < 100) next.add(id); // Bound batch size for either PLAN or FACT selection.
      return next;
    });
  }, [saving]);

  const close = useCallback(() => { if (!saving) onClose(); }, [onClose, saving]);
  const requestBack = useCallback(() => {
    if (saving) return;
    if (navigationContext?.onBack) requestBackTransition(navigationContext.onBack);
    else close();
  }, [navigationContext, requestBackTransition, saving, close]);

  const title = navigationContext?.title ?? 'Упражнения';
  const scrollKey = navigationContext?.scrollKey ?? 'root';
  const parentNavigationContext = useMemo<NavigationContext>(() => ({
    title,
    scrollKey: `workout-exercise-selection:${scrollKey}`,
    identity: { title, icon: 'barbell' },
    onBack: requestBack,
  }), [title, scrollKey, requestBack]);

  useEffect(() => {
    if (opened) onNavigationContextChange?.(parentNavigationContext);
  }, [opened, onNavigationContextChange, parentNavigationContext]);
  useEffect(() => {
    if (!opened) return;
    return () => { onNavigationContextChange?.(null); };
  }, [opened, onNavigationContextChange]);

  return (
      <section className="workout-exercise-selection">
        <header className="workout-exercise-selection__header">
          {navigationContext ? <IconButton icon="chevron-left" label="Назад" disabled={saving} onClick={requestBack} /> : null}
          <Text variant="headline">{title}</Text>
          <Button variant="secondary" size="compact" disabled={saving} onClick={close}>Закрыть</Button>
        </header>
        <div className="workout-exercise-selection__catalog">
          {actionError ? <Text variant="footnote" role="alert">{actionError}</Text> : null}
          {personalCatalogueRole ? <PersonalExercises role={personalCatalogueRole} mode="select"
            selectedExerciseIds={selectedIds} onToggleExercise={toggleExercise}
            selectionDisabled={saving} onNavigationContextChange={setNavigationContext} /> : <PublicExercises
            mode="select"
            selectedExerciseIds={selectedIds}
            onToggleExercise={toggleExercise}
            selectionDisabled={saving}
            onNavigationContextChange={setNavigationContext}
          />}
        </div>
        <footer className="workout-exercise-selection__footer">
          {selectedIds.size === 100 ? <Text variant="footnote" tone="muted">Максимум 100 упражнений за раз</Text> : null}
          <Button disabled={saving || selectedIds.size === 0} onClick={() => onConfirm([...selectedIds])}>
            {saving ? 'Добавляем…' : `Добавить упражнения (${selectedIds.size})`}
          </Button>
        </footer>
      </section>
  );
}
