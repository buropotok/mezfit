import { useEffect, useMemo, useRef, useState } from 'react';
import { Button as KonstaButton, List as KonstaList, ListInput } from 'konsta/react';
import type { NavigationContext } from '../NavigationShell';
import type { WorkoutPlanningRepository } from '../data/cloud/workout-planning';
import type { ProgramDetails } from '../data/cloud/program-management';
import { snapshotProgramDay, type LocalWorkoutOccurrenceDraft, type WorkoutOccurrencePlan } from '../data/cloud/workout-occurrence-plan';
import { Button, MezfitBottomSheet, MezfitDialog, MezfitDialogButton, NestedBadges, Text, type NestedBadgeItem } from '../ui';
import { LiquidGlassTextOnly } from '../ui/LiquidGlassTextOnly';
import './workout-planning.css';

interface Target { programId: string; phaseId: string; dayId?: string; expected?: WorkoutOccurrencePlan }

export function WorkoutProgramSheet({ opened, planner, draft, onClose, onNavigationContextChange }: {
  opened: boolean; planner: WorkoutPlanningRepository; draft: LocalWorkoutOccurrenceDraft;
  onClose: () => void; onNavigationContextChange?: (value: NavigationContext | null) => void;
}) {
  return <MezfitBottomSheet opened={opened} label="Добавить в программу" lazyMount>
    {opened ? <WorkoutProgramEditor planner={planner} draft={draft} onClose={onClose}
      onNavigationContextChange={onNavigationContextChange} /> : null}
  </MezfitBottomSheet>;
}

function WorkoutProgramEditor({ planner, draft, onClose, onNavigationContextChange }: {
  planner: WorkoutPlanningRepository; draft: LocalWorkoutOccurrenceDraft;
  onClose: () => void; onNavigationContextChange?: (value: NavigationContext | null) => void;
}) {
  const [programs, setPrograms] = useState<ProgramDetails[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [mode, setMode] = useState<'new' | 'update'>('new');
  const [target, setTarget] = useState<Target | null>(null);
  const [name, setName] = useState(draft.plan.name);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [programName, setProgramName] = useState('Программа тренировок');
  const running = useRef(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    const subscription = planner.programs.observeWorkoutTargets(draft.athleteUserId, rows => {
      setPrograms(rows); setLoading(false);
    }, reason => { setError(reason instanceof Error ? reason.message : 'Не удалось прочитать программы'); setLoading(false); });
    return () => subscription.unsubscribe();
  }, [planner, draft.athleteUserId]);
  useEffect(() => {
    onNavigationContextChange?.({ level: 2, title: 'Добавить в программу', contentMode: 'viewport',
      onBack: () => { if (!running.current) { if (confirm) setConfirm(false); else if (createOpen) setCreateOpen(false); else onClose(); } } });
    return () => onNavigationContextChange?.(null);
  }, [onNavigationContextChange, onClose, confirm, createOpen]);

  const selectedProgram = programs.find(row => row.program.id === target?.programId);
  const selectedPhase = selectedProgram?.phases.find(row => row.id === target?.phaseId);
  const selectedDay = selectedProgram?.days?.find(row => row.day.id === target?.dayId && row.day.programPhaseId === selectedPhase?.id);
  const ready = Boolean(selectedPhase && (mode === 'new' ? name.trim() : selectedDay));
  const run = async (work: () => Promise<void>) => {
    if (running.current) return;
    running.current = true; setBusy(true); setError('');
    try { await work(); }
    catch (reason) { if (alive.current) setError(reason instanceof Error ? reason.message : 'Не удалось сохранить день'); }
    finally { running.current = false; if (alive.current) setBusy(false); }
  };
  const save = () => run(async () => {
    if (!target || !ready) throw new Error('Выберите программу и фазу');
    await planner.addToProgram(draft.id, { ...target,
      dayId: mode === 'update' ? target.dayId : undefined,
      expected: mode === 'update' ? target.expected : undefined,
      name: mode === 'update' ? selectedDay?.day.name ?? '' : name });
    if (alive.current) onClose();
  });
  const choose = (label: string, selected: boolean, onClick: () => void) =>
    <KonstaButton small tonal disabled={busy} aria-label={label} aria-pressed={selected} onClick={onClick}>
      {selected ? 'Выбрано' : 'Выбрать'}
    </KonstaButton>;
  const items = useMemo<NestedBadgeItem[]>(() => programs.map(details => ({
    id: details.program.id, label: details.program.name, color: 'blue',
    info: choose('Выбрать программу', target?.programId === details.program.id,
      () => setTarget({ programId: details.program.id, phaseId: '' })),
    children: details.phases.map(phase => ({
      id: phase.id, label: phase.name, color: 'yellow',
      info: choose('Выбрать фазу', target?.programId === details.program.id && target.phaseId === phase.id,
        () => setTarget({ programId: details.program.id, phaseId: phase.id })),
      children: mode === 'new' ? undefined : (details.days ?? [])
        .filter(day => day.day.programPhaseId === phase.id).map(day => ({
          id: day.day.id, label: day.day.name, color: 'purple',
          info: choose('Выбрать день', target?.dayId === day.day.id,
            () => setTarget({ programId: details.program.id, phaseId: phase.id,
              dayId: day.day.id, expected: snapshotProgramDay(day) })),
        })),
    })),
  })), [programs, target, mode, busy]);

  return <section className="workout-planning-sheet">
    <header className="workout-planning-sheet__header">
      <Text variant="headline">Добавить в программу</Text>
      <Button variant="secondary" disabled={busy} onClick={onClose}>Назад</Button>
    </header>
    <LiquidGlassTextOnly hidden={false} fullWidth value={mode}
      tabs={[{ value: 'update', label: 'Обновить день' }, { value: 'new', label: 'Создать новый день' }]}
      onValueChange={value => { if (!busy && (value === 'new' || value === 'update')) setMode(value); }} />
    {mode === 'new' ? <KonstaList nested><ListInput label="Название дня" value={name} maxLength={120}
      disabled={busy} onChange={event => setName(event.target.value)} /></KonstaList> : null}
    {loading ? <Text variant="body">Загружаем программы…</Text> : programs.length
      ? <NestedBadges items={items} /> : <Text variant="body">Подходящих программ пока нет</Text>}
    <KonstaButton tonal disabled={busy} onClick={() => setCreateOpen(true)}>Создать программу</KonstaButton>
    {selectedProgram ? <KonstaButton tonal disabled={busy} onClick={() => { void run(async () => {
      const phaseId = await planner.programs.createPhase(selectedProgram.program.id);
      if (alive.current) setTarget({ programId: selectedProgram.program.id, phaseId });
    }); }}>Добавить фазу</KonstaButton> : null}
    {error ? <Text variant="footnote" role="alert">{error}</Text> : null}
    <KonstaButton disabled={busy || !ready} onClick={() => {
      if (mode === 'update') setConfirm(true); else void save();
    }}>Сохранить</KonstaButton>
    <MezfitDialog opened={confirm} title="Обновить день программы?" buttons={<>
      <MezfitDialogButton disabled={busy} onClick={() => setConfirm(false)}>Отмена</MezfitDialogButton>
      <MezfitDialogButton strong disabled={busy} onClick={() => { setConfirm(false); void save(); }}>Обновить</MezfitDialogButton>
    </>}><Text variant="body">Содержание выбранного дня будет заменено. История тренировок сохранится.</Text></MezfitDialog>
    <MezfitDialog opened={createOpen} title="Создать программу" buttons={<>
      <MezfitDialogButton disabled={busy} onClick={() => setCreateOpen(false)}>Отмена</MezfitDialogButton>
      <MezfitDialogButton strong disabled={busy || !programName.trim()} onClick={() => { void run(async () => {
        const id = draft.athleteUserId === planner.actorUserId
          ? await planner.programs.createPersonal(programName)
          : await planner.programs.createAssigned(draft.athleteUserId, programName);
        const details = await planner.programs.details(id);
        if (alive.current) { setTarget({ programId: id, phaseId: details?.phases[0]?.id ?? '' }); setCreateOpen(false); }
      }); }}>Создать</MezfitDialogButton>
    </>}><KonstaList nested><ListInput label="Название программы" value={programName} maxLength={120}
      disabled={busy} onChange={event => setProgramName(event.target.value)} /></KonstaList>
      {error ? <Text variant="footnote" role="alert">{error}</Text> : null}
    </MezfitDialog>
  </section>;
}
