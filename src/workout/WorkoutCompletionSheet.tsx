import { useEffect, useRef, useState } from 'react';
import { Button } from 'konsta/react';
import type { NavigationContext } from '../NavigationShell';
import type { CloudWorkoutOccurrenceRow } from '../data/cloud/workout-foundation-types';
import { calendarDate, calendarTime, localScheduleInstant } from '../schedule/calendar-time';
import { useWorkoutPerson } from '../schedule/WorkoutPerson';
import { DatePicker, GlassSurface, Icon, IconButton, MezfitBottomSheet, Text, TimePicker,
  type LocalDate, type LocalTime } from '../ui';
import { WorkoutPlanCardHeader } from './WorkoutPlanCard';
import './workout-completion-sheet.css';

function ReviewCard({ row, expanded, busy, onToggle, onCancel, onMove, onKeep }: {
  row: CloudWorkoutOccurrenceRow; expanded: boolean; busy: boolean;
  onToggle: () => void; onCancel: () => void; onMove: () => void; onKeep: () => void;
}) {
  const athlete = useWorkoutPerson(row.athleteUserId, row.realmId);
  const start = new Date(row.startsAtUtc);
  const end = new Date(start.getTime() + row.durationMinutes * 60_000);
  return <article>
    <GlassSurface component="button" shape="rounded" preset="modalTuned"
      className="workout-completion-sheet__card" disabled={busy}
      aria-label={`Действия: ${athlete.name}, ${row.plan.name}`} aria-expanded={expanded} onClick={onToggle}>
      <WorkoutPlanCardHeader name={row.plan.name} programName={athlete.name} creatorName={athlete.name}
        athleteName={athlete.name} athleteAvatar={athlete.avatar} collapsed
        scheduledTiming={{ date: start.toLocaleDateString('ru-RU'), time: `${calendarTime(start)} – ${calendarTime(end)}` }}>
        <Icon name={expanded ? 'chevron-down' : 'chevron-right'} />
      </WorkoutPlanCardHeader>
    </GlassSurface>
    <div className={`workout-completion-sheet__disclosure${expanded ? ' workout-completion-sheet__disclosure--open' : ''}`}
      aria-hidden={!expanded} inert={!expanded ? true : undefined}>
      <div><div className="workout-completion-sheet__actions">
        <Button rounded strong disabled={busy} onClick={onCancel}><Text variant="body">Отменить тренировку</Text></Button>
        <Button rounded tonal disabled={busy} onClick={onMove}><Text variant="body">Перенести тренировку</Text></Button>
        <Button rounded tonal disabled={busy} onClick={onKeep}><Text variant="body">Оставить как есть</Text></Button>
      </div></div>
    </div>
  </article>;
}

function MoveWorkout({ row, busy, onBack, onMove, onError }: {
  row: CloudWorkoutOccurrenceRow; busy: boolean; onBack: () => void;
  onMove: (startsAtUtc: string) => void; onError: (reason: unknown) => void;
}) {
  const original = new Date(row.startsAtUtc);
  const [date, setDate] = useState<LocalDate>(calendarDate(original));
  const [time, setTime] = useState<LocalTime>(calendarTime(original));
  const [dateOpen, setDateOpen] = useState(false);
  const [timeOpen, setTimeOpen] = useState(false);
  const target = useRef<HTMLButtonElement>(null);
  return <div className="workout-completion-sheet__move">
    <Text variant="body">{row.plan.name}</Text>
    <Button rounded tonal disabled={busy} onClick={() => setDateOpen(true)}>
      <Text variant="body">Дата: {date.split('-').reverse().join('.')}</Text>
    </Button>
    <Button ref={target} rounded tonal disabled={busy} onClick={() => setTimeOpen(true)}>
      <Text variant="body">Начало: {time}</Text>
    </Button>
    <Text variant="footnote" tone="muted">Длительность: {row.durationMinutes} мин</Text>
    <Button rounded strong disabled={busy || dateOpen || timeOpen} onClick={() => {
      try { onMove(localScheduleInstant(date, time)); } catch (reason) { onError(reason); }
    }}><Text variant="body">Перенести</Text></Button>
    <Button rounded tonal disabled={busy} onClick={onBack}><Text variant="body">Назад</Text></Button>
    <DatePicker opened={dateOpen} value={date} onChange={value => { setDate(value); setDateOpen(false); }} onClose={() => setDateOpen(false)} />
    <TimePicker opened={timeOpen} value={time} onChange={setTime} onClose={() => setTimeOpen(false)} target={target.current} />
  </div>;
}

export function WorkoutCompletionSheet({ rows, busy, onClose, onCancel, onMove, onKeep, onError, onNavigationContextChange }: {
  rows: readonly CloudWorkoutOccurrenceRow[]; busy: boolean;
  onClose: () => void; onCancel: (row: CloudWorkoutOccurrenceRow) => void;
  onMove: (row: CloudWorkoutOccurrenceRow, startsAtUtc: string) => void;
  onKeep: (id: string) => void; onError: (reason: unknown) => void;
  onNavigationContextChange?: (context: NavigationContext | null) => void;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [moving, setMoving] = useState<string | null>(null);
  const moveRow = rows.find(row => row.id === moving);
  const back = () => { if (!busy) { if (moveRow) setMoving(null); else onClose(); } };
  const backRef = useRef(back); backRef.current = back;
  useEffect(() => {
    if (!rows.length) return;
    onNavigationContextChange?.({ level: 2, title: moveRow ? 'Перенести тренировку' : 'Пересечения тренировок',
      onBack: () => backRef.current() });
    return () => onNavigationContextChange?.(null);
  }, [rows.length > 0, Boolean(moveRow), onNavigationContextChange]);
  return <MezfitBottomSheet opened={rows.length > 0} label={moveRow ? 'Перенести тренировку' : 'Пересечения тренировок'} lazyMount>
    <section className="workout-completion-sheet">
      <header><Text variant="headline">{moveRow ? 'Перенести тренировку' : 'Пересечения тренировок'}</Text>
        <IconButton icon="x" label="Закрыть пересечения" disabled={busy} onClick={onClose} /></header>
      {moveRow ? <MoveWorkout key={moveRow.id} row={moveRow} busy={busy} onBack={() => setMoving(null)}
        onMove={value => onMove(moveRow, value)} onError={onError} /> : <>
        <Text variant="body">С завершённой тренировкой пересекаются запланированные тренировки. Нажмите на тренировку для выбора действия</Text>
        <div className="workout-completion-sheet__list">{rows.map(row => <ReviewCard key={row.id} row={row}
          expanded={expanded === row.id} busy={busy} onToggle={() => setExpanded(id => id === row.id ? null : row.id)}
          onCancel={() => onCancel(row)} onMove={() => setMoving(row.id)} onKeep={() => onKeep(row.id)} />)}</div>
      </>}
    </section>
  </MezfitBottomSheet>;
}
