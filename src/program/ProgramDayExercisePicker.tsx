import { useEffect, useMemo, useRef, useState } from 'react';
import { List, ListInput } from 'konsta/react';
import type { TrackingType } from '../api';
import type { NavigationContext } from '../NavigationShell';
import type { CloudTrainingPlanRow } from '../data/cloud/database';
import type { ProgramManagementRepository } from '../data/cloud/program-management';
import type { PreparedProgramExercise } from '../data/cloud/program-exercise-selection';
import { WorkoutExerciseSelectionSheet } from '../workout/WorkoutExerciseSelectionSheet';
import { MezfitDialog, MezfitDialogButton, Text } from '../ui';
import { programMutationMessage } from './programPresentation';

const TRACKING_OPTIONS: readonly { value: TrackingType; label: string }[] = [
  { value: 'weight_reps', label: 'Вес и повторения' }, { value: 'time', label: 'Время' },
  { value: 'time_distance', label: 'Время и расстояние' },
  { value: 'time_reps', label: 'Время и повторения' }, { value: 'time_weight', label: 'Время и вес' },
];

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
  const [prepared, setPrepared] = useState<PreparedProgramExercise[] | null>(null);
  const [sheetNavigation, setSheetNavigation] = useState<NavigationContext | null>(null);
  const [choices, setChoices] = useState<Record<string, TrackingType>>({});
  const running = useRef(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const close = () => { if (!running.current) setClosing(true); };
  const save = async (ids: string[], resolved?: PreparedProgramExercise[]) => {
    if (running.current || dayId === null) return;
    running.current = true;
    setBusy(true);
    setError('');
    try {
      const items = resolved ?? await repository.prepareDayExercises(ids);
      if (!alive.current) return;
      if (items.some(item => item.trackingType === null && !choices[item.id])) {
        setPrepared(items);
        return;
      }
      await repository.addDayExercises(program.id, dayId, items.map(item => ({
        id: item.id, trackingType: choices[item.id] ?? item.trackingType ?? undefined,
      })));
      if (alive.current) { setPrepared(null); setClosing(true); }
    } catch (reason) {
      if (alive.current) setError(programMutationMessage(reason));
    } finally {
      running.current = false;
      if (alive.current) setBusy(false);
    }
  };
  const navigation = useMemo<NavigationContext | null>(() => prepared ? {
    title: 'Тип учёта', scrollKey: `program-exercise-tracking:${dayId}`,
    onBack: () => { if (!running.current) { setPrepared(null); setError(''); } },
  } : sheetNavigation, [prepared, sheetNavigation, dayId]);
  useEffect(() => {
    onNavigationContextChange?.(navigation);
    return () => onNavigationContextChange?.(null);
  }, [navigation, onNavigationContextChange]);
  const unresolved = prepared?.filter(item => item.trackingType === null) ?? [];
  return <>
    <WorkoutExerciseSelectionSheet opened={opened} initData="" personalCatalogueRole={catalogueRole}
      saving={busy || prepared !== null} actionError={prepared ? '' : error}
      onConfirm={ids => { void save(ids); }} onClose={close}
      onClosed={() => {
        setClosing(false); setChoices({}); setPrepared(null); setError(''); onClose();
      }} onNavigationContextChange={setSheetNavigation} />
    <MezfitDialog opened={prepared !== null} title="Тип учёта" role="dialog" aria-label="Тип учёта"
      buttons={<>
        <MezfitDialogButton disabled={busy} onClick={() => { setPrepared(null); setError(''); }}>Отмена</MezfitDialogButton>
        <MezfitDialogButton strong disabled={busy || unresolved.some(item => !choices[item.id])}
          onClick={() => { if (prepared) void save(prepared.map(item => item.id), prepared); }}>Добавить</MezfitDialogButton>
      </>}>
      <Text variant="body">Выберите тип учёта для упражнений без определённого типа движения.</Text>
      <List nested>{unresolved.map(item => <ListInput key={item.id} type="select" label={item.name}
        value={choices[item.id] ?? ''} disabled={busy}
        onChange={event => {
          const selected = TRACKING_OPTIONS.find(option => option.value === event.target.value);
          if (selected) setChoices(current => ({ ...current, [item.id]: selected.value }));
        }}>
        <option value="" disabled>Выберите тип учёта</option>
        {TRACKING_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
      </ListInput>)}</List>
      {error ? <Text variant="footnote" role="alert">{error}</Text> : null}
    </MezfitDialog>
  </>;
}
