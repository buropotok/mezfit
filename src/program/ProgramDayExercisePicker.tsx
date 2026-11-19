import { useCallback, useEffect, useRef, useState } from 'react';
import type { NavigationContext } from '../NavigationShell';
import type { CloudTrainingPlanRow } from '../data/cloud/database';
import type { CloudProgramExerciseSnapshot } from '../data/cloud/workout-foundation-types';
import type { ProgramManagementRepository } from '../data/cloud/program-management';
import { WorkoutExerciseSelectionSheet } from '../workout/WorkoutExerciseSelectionSheet';
import { ExerciseReplacementDialog } from '../workout/ExerciseReplacementDialog';
import { programMutationMessage } from './programPresentation';

export function ProgramDayExercisePicker({ repository, program, dayId, onClose, onNavigationContextChange, catalogueRole = 'coach', replacement = null }: {
  repository: ProgramManagementRepository;
  catalogueRole?: 'coach' | 'client';
  program: CloudTrainingPlanRow;
  dayId: string | null;
  replacement?: { exerciseId: string; snapshot: CloudProgramExerciseSnapshot } | null;
  onClose: () => void;
  onNavigationContextChange?: (context: NavigationContext | null) => void;
}) {
  const [closing, setClosing] = useState(false);
  const [choice, setChoice] = useState<{ definitionId: string; compatible: boolean } | null>(null);
  const opened = dayId !== null && !closing && choice === null;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sheetNavigation, setSheetNavigation] = useState<NavigationContext | null>(null);
  const running = useRef(false);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const cancelReplacement = useCallback(() => {
    if (running.current) return;
    setChoice(null);
    onCloseRef.current();
  }, []);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const close = () => { if (!running.current) setClosing(true); };
  const save = async (ids: string[]) => {
    if (running.current || dayId === null) return;
    running.current = true;
    setBusy(true);
    setError('');
    try {
      if (replacement) {
        const [previous, next] = await Promise.all([
          repository.trackingTypeForExercise(replacement.snapshot),
          repository.replacementTrackingType(ids[0]),
        ]);
        if (alive.current) setChoice({ definitionId: ids[0], compatible: previous !== null && previous === next });
      } else {
        await repository.addDayExercises(program.id, dayId, ids);
        if (alive.current) setClosing(true);
      }
    } catch (reason) {
      if (alive.current) setError(programMutationMessage(reason));
    } finally {
      running.current = false;
      if (alive.current) setBusy(false);
    }
  };
  const confirmReplacement = async (preserveSets: boolean) => {
    if (!replacement || !choice || dayId === null || running.current) return;
    running.current = true;
    setBusy(true); setError('');
    try {
      await repository.replaceDayExercise(program.id, dayId, replacement.exerciseId,
        choice.definitionId, preserveSets);
      if (alive.current) { setChoice(null); onClose(); }
    } catch (reason) {
      if (alive.current) setError(programMutationMessage(reason));
    } finally {
      running.current = false;
      if (alive.current) setBusy(false);
    }
  };
  useEffect(() => {
    const current: NavigationContext | null = choice
      ? { level: 2, title: 'Замена упражнения', onBack: cancelReplacement }
      : sheetNavigation;
    onNavigationContextChange?.(current);
    return () => onNavigationContextChange?.(null);
  }, [choice, sheetNavigation, cancelReplacement, onNavigationContextChange]);
  return <>
    <WorkoutExerciseSelectionSheet opened={opened} initData="" personalCatalogueRole={catalogueRole}
      mode={replacement ? 'replace' : 'add'} saving={busy} actionError={error}
      onConfirm={ids => { void save(ids); }} onClose={close}
      onClosed={() => {
        if (choice) return;
        setClosing(false); setError(''); onClose();
      }} onNavigationContextChange={setSheetNavigation} />
    {choice ? <ExerciseReplacementDialog opened compatible={choice.compatible}
      busy={busy} error={error} onCancel={cancelReplacement}
      onConfirm={value => { void confirmReplacement(value); }} /> : null}
  </>;
}
