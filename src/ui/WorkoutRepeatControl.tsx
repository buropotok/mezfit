import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { BadgeChoice } from './Badge';
import { MezfitDialog, MezfitDialogButton } from './konsta-mezfit/Dialog';
import { Text } from './primitives';
import type { WorkoutRepeatRule } from '../data/cloud/workout-recurrence';
import { defaultWorkoutRepeatRule } from '../data/cloud/workout-recurrence';
import './workout-repeat-control.css';

const WEEKDAYS = [
  { day: 1, label: 'Пн' }, { day: 2, label: 'Вт' }, { day: 3, label: 'Ср' },
  { day: 4, label: 'Чт' }, { day: 5, label: 'Пт' }, { day: 6, label: 'Сб' },
  { day: 0, label: 'Вс' },
];

export function repeatRuleLabel(rule: WorkoutRepeatRule | null): string {
  if (!rule) return 'Повторять';
  const days = rule.weekdays.length === 7 ? 'Каждый день'
    : WEEKDAYS.filter(item => rule.weekdays.includes(item.day)).map(item => item.label).join(', ');
  return `${days} · ${rule.weeks} нед.`;
}

/** Reusable Mezfit UIkit control: no recurrence persistence or scheduling inside the UI. */
export function WorkoutRepeatControl({ value, onChange, startsAtUtc, disabled = false, locked = false }: {
  value: WorkoutRepeatRule | null;
  onChange: (value: WorkoutRepeatRule | null) => void;
  startsAtUtc: string;
  disabled?: boolean;
  /** Already materialized series are read-only until explicit series-edit support exists. */
  locked?: boolean;
}) {
  const [opened, setOpened] = useState(false);
  const [draft, setDraft] = useState<WorkoutRepeatRule>(() => value ?? defaultWorkoutRepeatRule(startsAtUtc));
  useEffect(() => {
    if (opened) setDraft(value ?? defaultWorkoutRepeatRule(startsAtUtc));
  }, [opened, value, startsAtUtc]);
  const setDays = (days: number[]) => setDraft(current => ({ ...current, weekdays: days }));
  const close = () => setOpened(false);
  return <>
    <BadgeChoice color={value ? 'green' : 'gray'} textVariant="caption" disabled={disabled}
      onClick={() => setOpened(true)}>
      {repeatRuleLabel(value)}
    </BadgeChoice>
    {opened && typeof document !== 'undefined' ? createPortal(<MezfitDialog opened title={<Text variant="headline">Повторять тренировку</Text>}
      onBackdropClick={close}
      buttons={locked ? <MezfitDialogButton onClick={close}><Text variant="body">Закрыть</Text></MezfitDialogButton>
        : <>
          <MezfitDialogButton onClick={() => { onChange(null); close(); }}><Text variant="body">Без повторения</Text></MezfitDialogButton>
          <MezfitDialogButton strong disabled={!draft.weekdays.length}
            onClick={() => { onChange({ weekdays: [...draft.weekdays], weeks: draft.weeks }); close(); }}>
            <Text variant="body">Применить</Text>
          </MezfitDialogButton>
        </>}>
      <div className="workout-repeat-control">
        {locked ? <Text variant="body">Серия уже создана. Каждую тренировку пока можно редактировать отдельно.</Text> : <>
          <Text variant="body">Дни повторения</Text>
          <div className="workout-repeat-control__presets">
            <BadgeChoice selected={draft.weekdays.length === 7} onClick={() => setDays([0, 1, 2, 3, 4, 5, 6])}>Каждый день</BadgeChoice>
            <BadgeChoice selected={draft.weekdays.length === 1 && draft.weekdays[0] === new Date(startsAtUtc).getDay()}
              onClick={() => setDays([new Date(startsAtUtc).getDay()])}>Раз в неделю</BadgeChoice>
          </div>
          <div className="workout-repeat-control__days" role="group" aria-label="Дни недели">
            {WEEKDAYS.map(item => <BadgeChoice key={item.day} selected={draft.weekdays.includes(item.day)}
              onClick={() => setDays(draft.weekdays.includes(item.day)
                ? draft.weekdays.filter(day => day !== item.day) : [...draft.weekdays, item.day])}>
              {item.label}
            </BadgeChoice>)}
          </div>
          <Text variant="body">Продолжительность серии</Text>
          <div className="workout-repeat-control__presets" role="group" aria-label="Количество недель">
            {([2, 3, 4] as const).map(weeks => <BadgeChoice key={weeks} selected={draft.weeks === weeks}
              onClick={() => setDraft(current => ({ ...current, weeks }))}>{weeks} нед.</BadgeChoice>)}
          </div>
          <Text variant="footnote" tone="muted">
            Исходная тренировка сохранится на своей дате. Повторения создадутся в то же местное время.
            Если хотя бы один слот занят, серия не создастся.
          </Text>
        </>}
      </div>
    </MezfitDialog>, document.body) : null}
  </>;
}
