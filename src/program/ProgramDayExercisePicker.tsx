import { useEffect, useRef, useState } from 'react';
import type { NavigationContext } from '../NavigationShell';
import type { CloudTrainingPlanRow } from '../data/cloud/database';
import type { ProgramManagementRepository } from '../data/cloud/program-management';
import { WorkoutExerciseSelectionSheet } from '../workout/WorkoutExerciseSelectionSheet';
import { programMutationMessage } from './programPresentation';

export function ProgramDayExercisePicker({ repository, program, dayId, onClose, onNavigationContextChange, catalogueRole = 'coach' }: {
  repository: ProgramManagementRepository;
  catalogueRole?: 'coach' | 'client';
  program: CloudTrainingPlanRow;
  dayId: string | null;
  onClose: () => void;
  onNavigationContextChange?: (context: NavigationContext | null) => void;
}) {
  const [closing, setClosing] = useState(false);
  const opened = dayId !== null && !closing;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sheetNavigation, setSheetNavigation] = useState<NavigationContext | null>(null);
  const running = useRef(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const close = () => { if (!running.current) setClosing(true); };
  const save = async (ids: string[]) => {
    if (running.current || dayId === null) return;
    running.current = true;
    setBusy(true);
    setError('');
    try {
      await repository.addDayExercises(program.id, dayId, ids);
      if (alive.current) setClosing(true);
    } catch (reason) {
      if (alive.current) setError(programMutationMessage(reason));
    } finally {
      running.current = false;
      if (alive.current) setBusy(false);
    }
  };
  useEffect(() => {
    onNavigationContextChange?.(sheetNavigation);
    return () => onNavigationContextChange?.(null);
  }, [sheetNavigation, onNavigationContextChange]);
  return <WorkoutExerciseSelectionSheet opened={opened} initData="" personalCatalogueRole={catalogueRole}
    saving={busy} actionError={error}
    onConfirm={ids => { void save(ids); }} onClose={close}
    onClosed={() => {
      setClosing(false); setError(''); onClose();
    }} onNavigationContextChange={setSheetNavigation} />;
}
