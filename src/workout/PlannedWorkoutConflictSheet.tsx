import { Button, Block, Sheet } from 'konsta/react';
import { useCallback, useEffect, useId, useRef } from 'react';
import type { CloudWorkoutOccurrenceRow } from '../data/cloud/workout-foundation-types';
import { useWorkoutPerson } from '../schedule/WorkoutPerson';
import { Text } from '../ui';

/** Public Konsta Sheet; completion follows its own root transition, not a guessed delay. */
export function PlannedWorkoutConflictSheet({ occurrence, opened, onDecision, onClosed }: {
  occurrence: CloudWorkoutOccurrenceRow | null; opened: boolean;
  onDecision: (decision: 'cancel' | 'back') => void; onClosed: () => void;
}) {
  const id = useId();
  const seen = useRef(false);
  const callback = useRef(onClosed);
  callback.current = onClosed;
  const finish = useCallback(() => {
    if (!opened && seen.current) { seen.current = false; callback.current(); }
  }, [opened]);
  useEffect(() => {
    if (opened) { seen.current = true; return; }
    if (!seen.current) return;
    const root = document.getElementById(id);
    const style = root ? getComputedStyle(root) : null;
    const ms = (value: string) => (Number.parseFloat(value) || 0) * (value.trim().endsWith('ms') ? 1 : 1000);
    const durations = style?.transitionDuration.split(',').map(ms) ?? [0];
    const delays = style?.transitionDelay.split(',').map(ms) ?? [0];
    const duration = style?.transitionProperty === 'none' ? 0
      : Math.max(0, ...durations.map((value, index) => value + delays[index % delays.length]));
    const timer = window.setTimeout(finish, duration);
    return () => window.clearTimeout(timer);
  }, [opened, finish, id]);
  const person = useWorkoutPerson(occurrence?.athleteUserId ?? null, occurrence?.realmId ?? '');
  return <Sheet id={id} opened={opened} backdrop onBackdropClick={() => onDecision('back')}
    onTransitionEnd={event => { if (event.target === event.currentTarget) finish(); }}
    role="dialog" aria-label="Конфликт тренировок" aria-hidden={opened ? undefined : true} inert={opened ? undefined : true}>
    {occurrence ? <Block className="flex flex-col gap-3">
      <Text variant="headline">На это время назначена тренировка: {person.name}</Text>
      <Text variant="body">Отмените её или перенесите, чтобы начать тренировку другого клиента.</Text>
      <Button rounded strong onClick={() => onDecision('cancel')}>Отменить тренировку</Button>
      <Button rounded tonal disabled>Перенести тренировку</Button>
      <Button rounded tonal onClick={() => onDecision('back')}>Назад</Button>
    </Block> : null}
  </Sheet>;
}
