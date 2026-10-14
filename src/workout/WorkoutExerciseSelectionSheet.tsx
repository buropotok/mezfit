import { useCallback, useEffect, useMemo, useState } from 'react';
import { PublicExercises } from '../exercises/PublicExercises';
import { useNavigationBackTransition, type NavigationContext } from '../NavigationShell';
import { Button, IconButton, MezfitBottomSheet, Text } from '../ui';
import './workout-exercise-selection.css';

interface WorkoutExerciseSelectionSheetProps {
  initData: string;
  saving: boolean;
  actionError?: string;
  onConfirm: (publicExerciseIds: string[]) => void;
  onClose: () => void;
  onNavigationContextChange?: (context: NavigationContext | null) => void;
}

/**
 * One shared Dexie Cloud catalogue for browsing and selecting.
 * The legacy workout write translates stable cloud IDs on the Worker boundary.
 */
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

  const toggleExercise = useCallback((id: string) => {
    if (saving) return;
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else if (next.size < 100) next.add(id); // Match the server's bounded mutation contract.
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

  useEffect(() => { onNavigationContextChange?.(parentNavigationContext); }, [onNavigationContextChange, parentNavigationContext]);
  useEffect(() => () => { onNavigationContextChange?.(null); }, [onNavigationContextChange]);

  return (
    <MezfitBottomSheet opened label="Выбор упражнений для тренировки">
      <section className="workout-exercise-selection">
        <header className="workout-exercise-selection__header">
          {navigationContext ? <IconButton icon="chevron-left" label="Назад" disabled={saving} onClick={requestBack} /> : null}
          <Text variant="headline">{title}</Text>
          <Button variant="secondary" size="compact" disabled={saving} onClick={close}>Закрыть</Button>
        </header>
        <div className="workout-exercise-selection__catalog">
          {actionError ? <Text variant="footnote" role="alert">{actionError}</Text> : null}
          <PublicExercises
            mode="select"
            selectedExerciseIds={selectedIds}
            onToggleExercise={toggleExercise}
            selectionDisabled={saving}
            onNavigationContextChange={setNavigationContext}
          />
        </div>
        <footer className="workout-exercise-selection__footer">
          {selectedIds.size === 100 ? <Text variant="footnote" tone="muted">Максимум 100 упражнений за раз</Text> : null}
          <Button disabled={saving || selectedIds.size === 0} onClick={() => onConfirm([...selectedIds])}>
            {saving ? 'Добавляем…' : `Добавить упражнения (${selectedIds.size})`}
          </Button>
        </footer>
      </section>
    </MezfitBottomSheet>
  );
}
