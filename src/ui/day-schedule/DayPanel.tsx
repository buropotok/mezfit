import type { ReactNode } from 'react';
import { useDraggable } from '@dnd-kit/core';
import type { LocalDate } from '../date-picker/datePickerDate';

export const START_HOUR = 6;
export const END_HOUR = 24;
export const HOUR_HEIGHT = 112;

export type DayScheduleEventBase = {
  id: string;
  startMinutes: number;
  durationMinutes: number;
};

export type DayScheduleRenderState = {
  compact: boolean;
};

export function yForMinutes(totalMinutes: number): number {
  return ((totalMinutes - START_HOUR * 60) / 60) * HOUR_HEIGHT;
}

export function scheduleEventDragId(date: LocalDate, eventId: string): string {
  return `schedule-event:${date}:${eventId}`;
}

export function startMinutesAfterDrag(
  startMinutes: number,
  durationMinutes: number,
  deltaPixels: number,
): number {
  const deltaMinutes = deltaPixels / HOUR_HEIGHT * 60;
  const minStart = START_HOUR * 60;
  const maxStart = Math.max(minStart, END_HOUR * 60 - Math.max(0, durationMinutes));
  const minDelta = Math.min(0, minStart - startMinutes);
  const maxDelta = Math.max(0, maxStart - startMinutes);
  const clampedDelta = Math.max(minDelta, Math.min(maxDelta, Math.round(deltaMinutes)));
  return startMinutes + clampedDelta;
}

/** Clip to the displayed 06:00–24:00 range; visual size never exceeds time. */
export function eventGeometry(event: DayScheduleEventBase): { top: number; height: number } | null {
  if (!Number.isFinite(event.startMinutes) || !Number.isFinite(event.durationMinutes) || event.durationMinutes <= 0) return null;
  const start = Math.max(START_HOUR * 60, event.startMinutes);
  const end = Math.min(END_HOUR * 60, event.startMinutes + event.durationMinutes);
  if (end <= start) return null;
  const slotHeight = (end - start) / 60 * HOUR_HEIGHT;
  const inset = Math.min(6, slotHeight / 4);
  return { top: yForMinutes(start) + inset, height: slotHeight - 2 * inset };
}

function formatTime(totalMinutes: number): string {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function DraggableEventFrame<TEvent extends DayScheduleEventBase>({
  date,
  event,
  top,
  height,
  children,
}: {
  date: LocalDate;
  event: TEvent;
  top: number;
  height: number;
  children: ReactNode;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: scheduleEventDragId(date, event.id),
    attributes: { tabIndex: -1 },
  });

  return (
    <div
      ref={setNodeRef}
      className={`ui-day-schedule__event-frame${isDragging ? ' ui-day-schedule__event-frame--dragging' : ''}`}
      style={{ top, height }}
      data-event-id={event.id}
      data-schedule-no-swipe=""
      {...attributes}
      {...listeners}
    >
      {children}
    </div>
  );
}

export function DayPanel<TEvent extends DayScheduleEventBase>({
  date,
  events,
  renderEvent,
  today,
  nowMinutes,
  draggableEvents = false,
}: {
  date: LocalDate;
  events: readonly TEvent[];
  renderEvent: (event: TEvent, state: DayScheduleRenderState) => ReactNode;
  today: LocalDate;
  nowMinutes: number;
  draggableEvents?: boolean;
}) {
  const showNow = date === today && nowMinutes >= START_HOUR * 60 && nowMinutes < END_HOUR * 60;

  return (
    <div className="ui-day-schedule__day-panel" data-date={date}>
      <div className="ui-day-schedule__timeline">
        {Array.from({ length: END_HOUR - START_HOUR }, (_, index) => {
          const hour = START_HOUR + index;
          return (
            <div
              className="ui-day-schedule__hour-row"
              style={{ top: index * HOUR_HEIGHT }}
              key={hour}
            >
              <span className="ui-day-schedule__hour-label">{String(hour).padStart(2, '0')}:00</span>
            </div>
          );
        })}

        {events.map(event => {
          const geometry = eventGeometry(event);
          if (!geometry) return null;
          const { top, height } = geometry;
          const content = renderEvent(event, { compact: height < 72 });
          if (draggableEvents) {
            return (
              <DraggableEventFrame
                date={date}
                event={event}
                top={top}
                height={height}
                key={event.id}
              >
                {content}
              </DraggableEventFrame>
            );
          }
          return (
            <div
              className="ui-day-schedule__event-frame"
              style={{ top, height }}
              data-event-id={event.id}
              key={event.id}
            >
              {content}
            </div>
          );
        })}

        {showNow && (
          <div className="ui-day-schedule__now-line" style={{ top: yForMinutes(nowMinutes) }}>
            <span className="ui-day-schedule__now-time">{formatTime(nowMinutes)}</span>
          </div>
        )}
      </div>
    </div>
  );
}

