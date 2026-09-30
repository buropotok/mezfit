import type { ReactNode } from 'react';
import { List, ListItem } from 'konsta/react';
import type { DayScheduleRenderState } from './DaySchedule';

export type DayScheduleEventCardProps = {
  title: ReactNode;
  detail?: ReactNode;
  media?: ReactNode;
  state: DayScheduleRenderState;
  className?: string;
};

function formatMinutes(totalMinutes: number): string {
  const normalized = Math.max(0, Math.round(totalMinutes));
  const hours = Math.floor(normalized / 60);
  const minutes = normalized % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

export function DayScheduleEventCard({
  title,
  detail,
  media,
  state,
  className = '',
}: DayScheduleEventCardProps) {
  const endMinutes = state.startMinutes + state.durationMinutes;
  const timeRange = `${formatMinutes(state.startMinutes)}–${formatMinutes(endMinutes)}`;
  const subtitle = detail && !state.compact ? (
    <>
      {detail} · {timeRange}
    </>
  ) : timeRange;

  return (
    <div
      className={[
        'ui-day-schedule-event-card',
        state.lifted ? 'ui-day-schedule-event-card--lifted' : '',
        state.editing ? 'ui-day-schedule-event-card--editing' : '',
        className,
      ].filter(Boolean).join(' ')}
    >
      <List nested dividers={false}>
        <ListItem
          media={media}
          title={title}
          subtitle={subtitle}
        />
      </List>
    </div>
  );
}
