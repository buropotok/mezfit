import { useId, type ReactNode } from 'react';
import { List, ListItem } from 'konsta/react';
import { Text } from './primitives';
import type { DayScheduleRenderState } from './DaySchedule';
import './DayScheduleEventCard.css';

export type DayScheduleEventCardProps = {
  title: ReactNode;
  detail?: ReactNode;
  status?: ReactNode;
  media?: ReactNode;
  corner?: ReactNode;
  cornerSize?: number;
  state: DayScheduleRenderState;
  /** Visual color only; scheduling interactions remain identical. */
  variant?: 'workout' | 'event';
  cancelled?: boolean;
  className?: string;
  onClick?: () => void;
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
  status,
  media,
  corner,
  cornerSize = 24,
  state,
  variant = 'workout',
  className = '',
  cancelled = false,
  onClick,
}: DayScheduleEventCardProps) {
  const contentId = useId();
  const endMinutes = state.startMinutes + state.durationMinutes;
  const timeRange = `${formatMinutes(state.startMinutes)}–${formatMinutes(endMinutes)}`;
  const subtitle = <div className="ui-day-schedule-event-card__row">
    <Text variant="footnote" className="ui-day-schedule-event-card__fixed">{timeRange}</Text>
    {detail && !state.compact ? <Text variant="footnote" className="ui-day-schedule-event-card__truncate">{detail}</Text> : null}
  </div>;
  const resolvedMedia = !state.compact && media ? (
    <span className="ui-day-schedule-event-card__media">{media}</span>
  ) : undefined;

  return (
    <div
      onContextMenu={event => event.preventDefault()}
      onDragStart={event => event.preventDefault()}
      className={[
        'ui-day-schedule-event-card',
        cancelled ? 'ui-day-schedule-event-card--cancelled' : '',
        variant === 'event' ? 'ui-day-schedule-event-card--event' : '',
        state.lifted ? 'ui-day-schedule-event-card--lifted' : '',
        state.editing ? 'ui-day-schedule-event-card--editing' : '',
        state.compact ? 'ui-day-schedule-event-card--compact' : '',
        className,
      ].filter(Boolean).join(' ')}
    >
      <div id={contentId} className="ui-day-schedule-event-card__content" aria-hidden="true"
        style={corner ? { paddingInlineEnd: cornerSize + 10 } : undefined}>
      <List nested dividers={false} className="w-full">
        <ListItem
          contentClassName="!ps-[6px] min-h-0"
          mediaClassName="!py-0 !me-[6px]"
          innerClassName="!py-0 !pe-[6px] min-h-0 flex flex-col justify-center"
          titleWrapClassName="!min-h-0"
          media={resolvedMedia}
          title={<div className="ui-day-schedule-event-card__row">
            <Text variant="body" className="ui-day-schedule-event-card__truncate">{title}</Text>
            {status ? <span className="ui-day-schedule-event-card__fixed">{status}</span> : null}
          </div>}
          subtitle={subtitle}
        />
      </List>
      </div>
      {corner ? <span className="ui-day-schedule-event-card__corner"
        style={{ width: cornerSize, height: cornerSize }}>{corner}</span> : null}
      <button type="button" className="ui-day-schedule-event-card__touch"
        data-ui-dnd-handle="" aria-labelledby={contentId} onClick={onClick} />
    </div>
  );
}
