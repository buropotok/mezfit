import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { useDraggable } from '@dnd-kit/core';
import type { LocalDate } from '../date-picker/datePickerDate';

export const START_HOUR = 6;
export const END_HOUR = 24;
export const HOUR_HEIGHT = 64;
export const EVENT_EDGE_INSET = 1;
export const FULL_EVENT_CARD_HEIGHT = HOUR_HEIGHT - EVENT_EDGE_INSET * 2;
export const DRAG_SNAP_MINUTES = 15;

export type DayScheduleEventBase = {
  id: string;
  startMinutes: number;
  durationMinutes: number;
};

export type DayScheduleRenderState = {
  compact: boolean;
  lifted: boolean;
  editing: boolean;
  height: number;
  startMinutes: number;
  durationMinutes: number;
};

export type DayScheduleResizeEdge = 'start' | 'end';

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
  const maxStart = Math.max(minStart, Math.floor((END_HOUR * 60 - Math.max(0, durationMinutes)) / DRAG_SNAP_MINUTES) * DRAG_SNAP_MINUTES);
  const minDelta = Math.min(0, minStart - startMinutes);
  const maxDelta = Math.max(0, maxStart - startMinutes);

  if (Math.abs(deltaMinutes) < DRAG_SNAP_MINUTES / 2) return startMinutes;

  const rawTarget = startMinutes + deltaMinutes;
  const snappedTarget = Math.round(rawTarget / DRAG_SNAP_MINUTES) * DRAG_SNAP_MINUTES;
  const snappedDelta = snappedTarget - startMinutes;
  const clampedDelta = Math.max(minDelta, Math.min(maxDelta, snappedDelta));
  return startMinutes + clampedDelta;
}

function snapMinutes(value: number): number {
  return Math.round(value / DRAG_SNAP_MINUTES) * DRAG_SNAP_MINUTES;
}

function ceilToSnap(value: number): number {
  return Math.ceil(value / DRAG_SNAP_MINUTES) * DRAG_SNAP_MINUTES;
}

function floorToSnap(value: number): number {
  return Math.floor(value / DRAG_SNAP_MINUTES) * DRAG_SNAP_MINUTES;
}

export function eventFitsSlot(
  events: readonly DayScheduleEventBase[],
  eventId: string,
  startMinutes: number,
  durationMinutes: number,
): boolean {
  const endMinutes = startMinutes + durationMinutes;
  if (
    !Number.isFinite(startMinutes)
    || !Number.isFinite(durationMinutes)
    || durationMinutes <= 0
    || startMinutes < START_HOUR * 60
    || endMinutes > END_HOUR * 60
  ) return false;

  return events.every(other => {
    if (other.id === eventId || other.durationMinutes <= 0) return true;
    const otherEnd = other.startMinutes + other.durationMinutes;
    return endMinutes <= other.startMinutes || startMinutes >= otherEnd;
  });
}

export function resizedEventTiming(
  event: DayScheduleEventBase,
  edge: DayScheduleResizeEdge,
  deltaPixels: number,
  events: readonly DayScheduleEventBase[],
): { startMinutes: number; durationMinutes: number } {
  const deltaMinutes = deltaPixels / HOUR_HEIGHT * 60;
  if (Math.abs(deltaMinutes) < DRAG_SNAP_MINUTES / 2) {
    return { startMinutes: event.startMinutes, durationMinutes: event.durationMinutes };
  }

  const originalStart = event.startMinutes;
  const originalEnd = event.startMinutes + event.durationMinutes;
  const others = events.filter(other => other.id !== event.id && other.durationMinutes > 0);

  if (edge === 'start') {
    const previousBoundary = others.reduce((boundary, other) => {
      const otherEnd = other.startMinutes + other.durationMinutes;
      return otherEnd <= originalStart ? Math.max(boundary, otherEnd) : boundary;
    }, START_HOUR * 60);
    const minStart = ceilToSnap(previousBoundary);
    const maxStart = floorToSnap(originalEnd - DRAG_SNAP_MINUTES);
    const desiredStart = snapMinutes(originalStart + deltaMinutes);
    const nextStart = Math.max(minStart, Math.min(maxStart, desiredStart));
    return {
      startMinutes: nextStart,
      durationMinutes: originalEnd - nextStart,
    };
  }

  const nextBoundary = others.reduce((boundary, other) => (
    other.startMinutes >= originalEnd ? Math.min(boundary, other.startMinutes) : boundary
  ), END_HOUR * 60);
  const minEnd = ceilToSnap(originalStart + DRAG_SNAP_MINUTES);
  const maxEnd = floorToSnap(nextBoundary);
  const desiredEnd = snapMinutes(originalEnd + deltaMinutes);
  const nextEnd = Math.max(minEnd, Math.min(maxEnd, desiredEnd));
  return {
    startMinutes: originalStart,
    durationMinutes: nextEnd - originalStart,
  };
}

/** Clip to the displayed 06:00–24:00 range; visual size never exceeds time. */
export function eventGeometry(event: DayScheduleEventBase): { top: number; height: number } | null {
  if (!Number.isFinite(event.startMinutes) || !Number.isFinite(event.durationMinutes) || event.durationMinutes <= 0) return null;
  const start = Math.max(START_HOUR * 60, event.startMinutes);
  const end = Math.min(END_HOUR * 60, event.startMinutes + event.durationMinutes);
  if (end <= start) return null;
  const slotHeight = (end - start) / 60 * HOUR_HEIGHT;
  const inset = Math.min(EVENT_EDGE_INSET, slotHeight / 4);
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
      className={`ui-day-schedule__event-frame ui-day-schedule__event-frame--draggable${isDragging ? ' ui-day-schedule__event-frame--dragging' : ''}`}
      style={{ top, height }}
      data-event-id={event.id}
      data-event-date={date}
      data-ui-dnd-handle=""
      {...attributes}
      {...listeners}
    >
      {children}
    </div>
  );
}

function EditableEventFrame<TEvent extends DayScheduleEventBase>({
  date,
  event,
  events,
  renderEvent,
  onCommit,
  onDeleteRequest,
}: {
  date: LocalDate;
  event: TEvent;
  events: readonly TEvent[];
  renderEvent: (event: TEvent, state: DayScheduleRenderState) => ReactNode;
  onCommit: (event: TEvent, startMinutes: number, durationMinutes: number) => void;
  onDeleteRequest?: (event: TEvent) => void;
}) {
  const [draft, setDraft] = useState({
    startMinutes: event.startMinutes,
    durationMinutes: event.durationMinutes,
  });
  const resize = useRef<{
    pointerId: number;
    edge: DayScheduleResizeEdge;
    startY: number;
    startMinutes: number;
    durationMinutes: number;
  } | null>(null);

  useEffect(() => {
    setDraft({ startMinutes: event.startMinutes, durationMinutes: event.durationMinutes });
  }, [event.durationMinutes, event.startMinutes]);

  const draftEvent = { ...event, ...draft };
  const geometry = eventGeometry(draftEvent);
  if (!geometry) return null;
  const { top, height } = geometry;

  const beginResize = (edge: DayScheduleResizeEdge, pointerEvent: ReactPointerEvent<HTMLButtonElement>) => {
    if (pointerEvent.pointerType === 'mouse' && pointerEvent.button !== 0) return;
    pointerEvent.preventDefault();
    pointerEvent.stopPropagation();
    resize.current = {
      pointerId: pointerEvent.pointerId,
      edge,
      startY: pointerEvent.clientY,
      startMinutes: draft.startMinutes,
      durationMinutes: draft.durationMinutes,
    };
    try { pointerEvent.currentTarget.setPointerCapture(pointerEvent.pointerId); } catch { /* Optional in WebViews. */ }
  };

  const moveResize = (pointerEvent: ReactPointerEvent<HTMLButtonElement>) => {
    const state = resize.current;
    if (!state || state.pointerId !== pointerEvent.pointerId) return;
    pointerEvent.preventDefault();
    pointerEvent.stopPropagation();
    const baseEvent = {
      ...event,
      startMinutes: state.startMinutes,
      durationMinutes: state.durationMinutes,
    };
    setDraft(resizedEventTiming(baseEvent, state.edge, pointerEvent.clientY - state.startY, events));
  };

  const finishResize = (pointerEvent: ReactPointerEvent<HTMLButtonElement>, cancelled = false) => {
    const state = resize.current;
    if (!state || state.pointerId !== pointerEvent.pointerId) return;
    pointerEvent.preventDefault();
    pointerEvent.stopPropagation();
    resize.current = null;
    if (cancelled) {
      setDraft({ startMinutes: event.startMinutes, durationMinutes: event.durationMinutes });
      return;
    }
    if (draft.startMinutes !== event.startMinutes || draft.durationMinutes !== event.durationMinutes) {
      onCommit(event, draft.startMinutes, draft.durationMinutes);
      setDraft({ startMinutes: event.startMinutes, durationMinutes: event.durationMinutes });
    }
  };

  return (
    <div
      className="ui-day-schedule__event-frame ui-day-schedule__event-frame--editing"
      style={{ top, height }}
      data-event-id={event.id}
      data-event-date={date}
    >
      {renderEvent(event, {
        compact: height < FULL_EVENT_CARD_HEIGHT,
        lifted: false,
        editing: true,
        height,
        startMinutes: draft.startMinutes,
        durationMinutes: draft.durationMinutes,
      })}
      <button
        type="button"
        className="ui-day-schedule__resize-handle ui-day-schedule__resize-handle--start"
        aria-label="Изменить время начала"
        onPointerDown={pointerEvent => beginResize('start', pointerEvent)}
        onPointerMove={moveResize}
        onPointerUp={pointerEvent => finishResize(pointerEvent)}
        onPointerCancel={pointerEvent => finishResize(pointerEvent, true)}
      />
      <button
        type="button"
        className="ui-day-schedule__resize-handle ui-day-schedule__resize-handle--end"
        aria-label="Изменить время окончания"
        onPointerDown={pointerEvent => beginResize('end', pointerEvent)}
        onPointerMove={moveResize}
        onPointerUp={pointerEvent => finishResize(pointerEvent)}
        onPointerCancel={pointerEvent => finishResize(pointerEvent, true)}
      />
      {onDeleteRequest ? (
        <button
          type="button"
          className="ui-day-schedule__delete-button"
          aria-label="Удалить карточку"
          onClick={(clickEvent) => {
            clickEvent.preventDefault();
            clickEvent.stopPropagation();
            onDeleteRequest(event);
          }}
        >
          <span className="ui-day-schedule__delete-icon" aria-hidden="true" />
        </button>
      ) : null}
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
  editingEventId,
  onEventResize,
  onEventDeleteRequest,
}: {
  date: LocalDate;
  events: readonly TEvent[];
  renderEvent: (event: TEvent, state: DayScheduleRenderState) => ReactNode;
  today: LocalDate;
  nowMinutes: number;
  draggableEvents?: boolean;
  editingEventId?: string;
  onEventResize?: (event: TEvent, startMinutes: number, durationMinutes: number) => void;
  onEventDeleteRequest?: (event: TEvent) => void;
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
          if (event.id === editingEventId && onEventResize) {
            return (
              <EditableEventFrame
                date={date}
                event={event}
                events={events}
                renderEvent={renderEvent}
                onCommit={onEventResize}
                onDeleteRequest={onEventDeleteRequest}
                key={event.id}
              />
            );
          }

          const geometry = eventGeometry(event);
          if (!geometry) return null;
          const { top, height } = geometry;
          const content = renderEvent(event, {
            compact: height < FULL_EVENT_CARD_HEIGHT,
            lifted: false,
            editing: false,
            height,
            startMinutes: event.startMinutes,
            durationMinutes: event.durationMinutes,
          });
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
              data-event-date={date}
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
