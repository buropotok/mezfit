import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import {
  DndContext,
  DragOverlay,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragMoveEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import type { LocalDate } from './date-picker/datePickerDate';
import {
  DayPanel,
  eventFitsSlot,
  eventGeometry,
  scheduleEventDragId,
  startMinutesAfterDrag,
  type DayScheduleEventBase,
  type DayScheduleRenderState,
  yForMinutes,
} from './day-schedule/DayPanel';
import { addDays, currentLocalDate, dayIndex, sameWeek, startOfWeek, titleForDate } from './day-schedule/dateMath';
import { WeekScene, type WeekSceneHandle } from './day-schedule/WeekScene';
import { useScheduleClock } from './day-schedule/useScheduleClock';
import { GlassSurface } from './GlassSurface';
import { DRAG_ACTIVATION_TOLERANCE, LONG_PRESS_DELAY_MS, SCHEDULE_TOUCH_ACTIVATION_TOLERANCE, UiPointerSensor, UiTouchSensor } from './dndSensors';
import './day-schedule.css';

const WEEK_SWIPE_THRESHOLD = 0.18;
const DAY_SWIPE_THRESHOLD = 0.18;
const TRANSITION_MS = 300;
const TRACK_TRANSITION = `transform ${TRANSITION_MS}ms ease-out`;
const POST_WEEK_TAP_DELAY_MS = 50;
const DRAG_DAY_EDGE_ZONE_PX = 64;
const DRAG_DAY_REPEAT_PAUSE_MS = 600;

type DragState = {
  pointerId: number;
  startX: number;
  startY: number;
  deltaX: number;
  startedAt: number;
  dragging: boolean;
  verticalScrolling: boolean;
  manualScroll: boolean;
  verticalOnly: boolean;
  startScrollTop: number;
  activationThreshold: number;
};

export type DayScheduleEvent = DayScheduleEventBase;
export type { DayScheduleRenderState };

export type DayScheduleEventMove = {
  eventId: string;
  date: LocalDate;
  targetDate: LocalDate;
  previousStartMinutes: number;
  startMinutes: number;
};

export type DayScheduleEventResize = {
  eventId: string;
  date: LocalDate;
  previousStartMinutes: number;
  previousDurationMinutes: number;
  startMinutes: number;
  durationMinutes: number;
};

export type DayScheduleProps<TEvent extends DayScheduleEvent = DayScheduleEvent> = {
  date: LocalDate;
  eventsByDate: Readonly<Record<LocalDate, readonly TEvent[]>>;
  onDateChange: (date: LocalDate) => void;
  renderEvent: (event: TEvent, state: DayScheduleRenderState) => ReactNode;
  onEventMove?: (move: DayScheduleEventMove) => void;
  onEventResize?: (resize: DayScheduleEventResize) => void;
  today?: LocalDate;
  className?: string;
};

export type DayScheduleValue = {
  date: LocalDate;
  title: string;
  weekdayIndex: number;
  isToday: boolean;
};

/** Derived data for a caller-owned navbar, including the initial controlled date. */
export function getDayScheduleValue(date: LocalDate, today = currentLocalDate()): DayScheduleValue {
  return { date, title: titleForDate(date, today), weekdayIndex: dayIndex(date), isToday: date === today };
}

export function DaySchedule<TEvent extends DayScheduleEvent>({
  date,
  eventsByDate,
  onDateChange,
  renderEvent,
  onEventMove,
  onEventResize,
  today: todayOverride,
  className,
}: DayScheduleProps<TEvent>) {
  const now = useScheduleClock();
  const today = todayOverride ?? currentLocalDate(now);
  const weekRef = useRef<WeekSceneHandle>(null);
  const weekViewportRef = useRef<HTMLDivElement>(null);
  const dayViewportRef = useRef<HTMLDivElement>(null);
  const timers = useRef<Set<number>>(new Set());
  const frames = useRef<Set<number>>(new Set());
  const weekTrackRef = useRef<HTMLDivElement>(null);
  const dayTrackRef = useRef<HTMLDivElement>(null);
  const weekGesture = useRef<DragState | null>(null);
  const dayGesture = useRef<DragState | null>(null);
  const initialScrollApplied = useRef(false);
  const busy = useRef(false);
  const suppressDayClickUntil = useRef(0);
  const currentDate = useRef(date);
  const latestChange = useRef(onDateChange);
  const eventDragActive = useRef(false);
  const activeEventDragRef = useRef<string | null>(null);
  const activeEventEntryRef = useRef<{ date: LocalDate; event: TEvent; height: number; compact: boolean } | null>(null);
  const dragPointerStartX = useRef<number | null>(null);
  const dragEdgeDirection = useRef<-1 | 0 | 1>(0);
  const dragPageDateRef = useRef<LocalDate | null>(null);
  const dragTargetDateRef = useRef<LocalDate | null>(null);
  const dragPageAnimatingRef = useRef(false);
  const dragRepeatTimer = useRef<number | null>(null);
  const pendingEditingEvent = useRef<{ date: LocalDate; eventId: string } | null>(null);
  const [activeEventDragId, setActiveEventDragId] = useState<string | null>(null);
  const [dragPageDate, setDragPageDate] = useState<LocalDate | null>(null);
  const [dragWeekDate, setDragWeekDate] = useState<LocalDate | null>(null);
  const [dragPageDirection, setDragPageDirection] = useState<-1 | 0 | 1>(0);
  const [dragPageAnimating, setDragPageAnimating] = useState(false);
  const [editingEvent, setEditingEvent] = useState<{ date: LocalDate; eventId: string } | null>(null);
  const arrival = useRef<{ date: LocalDate; week: boolean; from?: LocalDate } | null>(null);

  const weekDrag = useRef(0);
  const [weekAnimating, setWeekAnimating] = useState(false);
  const [weekDirection, setWeekDirection] = useState<-1 | 0 | 1>(0);
  const [weekSelectorSuppressed, setWeekSelectorSuppressed] = useState(false);
  const [dayTransition, setDayTransition] = useState<{ from: LocalDate; to: LocalDate } | null>(null);
  const dayDrag = useRef(0);
  const [dayAnimating, setDayAnimating] = useState(false);
  const [dayDirection, setDayDirection] = useState<-1 | 0 | 1>(0);

  const weekDisplayDate = dragWeekDate ?? date;
  const monday = startOfWeek(weekDisplayDate);
  const selectedIndex = dayIndex(weekDisplayDate);
  const previousMonday = addDays(monday, -7);
  const nextMonday = addDays(monday, 7);
  const draggingDisplayDate = activeEventDragId && dragPageDate ? dragPageDate : null;
  const displayDate = draggingDisplayDate ?? dayTransition?.from ?? date;
  const previousDate = draggingDisplayDate
    ? addDays(displayDate, -1)
    : dayTransition && dayTransition.to < displayDate
      ? dayTransition.to
      : addDays(displayDate, -1);
  const nextDate = draggingDisplayDate
    ? addDays(displayDate, 1)
    : dayTransition && dayTransition.to > displayDate
      ? dayTransition.to
      : addDays(displayDate, 1);

  const eventDragSensors = useSensors(
    useSensor(UiPointerSensor, {
      activationConstraint: { distance: DRAG_ACTIVATION_TOLERANCE },
    }),
    useSensor(UiTouchSensor, {
      activationConstraint: {
        delay: LONG_PRESS_DELAY_MS,
        tolerance: SCHEDULE_TOUCH_ACTIVATION_TOLERANCE,
      },
    }),
  );
  const dragEntries = useMemo(() => {
    const entries = new Map<string, { date: LocalDate; event: TEvent; height: number; compact: boolean }>();
    for (const entryDate of [previousDate, displayDate, nextDate]) {
      for (const event of eventsByDate[entryDate] ?? []) {
        const geometry = eventGeometry(event);
        if (!geometry) continue;
        entries.set(scheduleEventDragId(entryDate, event.id), {
          date: entryDate,
          event,
          height: geometry.height,
          compact: geometry.height < 72,
        });
      }
    }
    return entries;
  }, [displayDate, eventsByDate, nextDate, previousDate]);
  const activeEventEntry = activeEventDragId ? activeEventEntryRef.current : null;

  // These transforms belong to this component; pointer moves never rerender event cards.
  const setWeekDrag = (pixels: number) => {
    weekDrag.current = pixels;
    if (weekTrackRef.current) weekTrackRef.current.style.transform = `translate3d(calc(-33.333333% + ${pixels}px),0,0)`;
  };
  const setDayDrag = (pixels: number) => {
    dayDrag.current = pixels;
    if (dayTrackRef.current) dayTrackRef.current.style.transform = `translate3d(calc(-33.333333% + ${pixels}px),0,0)`;
  };

  const addTimer = (callback: () => void, delay: number) => {
    const id = window.setTimeout(() => {
      timers.current.delete(id);
      callback();
    }, delay);
    timers.current.add(id);
  };

  const addFrame = (callback: () => void) => {
    const id = window.requestAnimationFrame(() => {
      frames.current.delete(id);
      callback();
    });
    frames.current.add(id);
  };

  useEffect(() => () => {
    timers.current.forEach(id => window.clearTimeout(id));
    timers.current.clear();
    frames.current.forEach(id => window.cancelAnimationFrame(id));
    frames.current.clear();
    if (dragRepeatTimer.current !== null) window.clearTimeout(dragRepeatTimer.current);
  }, []);

  useLayoutEffect(() => {
    if (initialScrollApplied.current) return;
    const viewport = dayViewportRef.current;
    if (!viewport) return;
    viewport.scrollTop = Math.max(0, yForMinutes(8 * 60));
    initialScrollApplied.current = true;
  }, []);

  const clearPending = () => {
    timers.current.forEach(id => window.clearTimeout(id));
    timers.current.clear();
    frames.current.forEach(id => window.cancelAnimationFrame(id));
    frames.current.clear();
  };

  const resetPaging = () => {
    // Disable the transition synchronously, before any transform write or
    // WeekScene layout measurement. React batches the state changes below.
    // Recentring is bookkeeping, never a second (reverse) page animation.
    if (weekTrackRef.current) weekTrackRef.current.style.transition = 'none';
    if (dayTrackRef.current) dayTrackRef.current.style.transition = 'none';
    weekGesture.current = null;
    dayGesture.current = null;
    setWeekAnimating(false);
    setWeekDirection(0);
    setWeekDrag(0);
    setDayAnimating(false);
    setDayTransition(null);
    setDayDirection(0);
    setDayDrag(0);
  };

  useLayoutEffect(() => { latestChange.current = onDateChange; }, [onDateChange]);

  useLayoutEffect(() => {
    currentDate.current = date;
    const pendingEdit = pendingEditingEvent.current?.date === date ? pendingEditingEvent.current : null;
    if (pendingEdit) pendingEditingEvent.current = null;
    setEditingEvent(null);
    const expected = arrival.current?.date === date ? arrival.current : null;
    arrival.current = null;
    clearPending();
    resetPaging();
    busy.current = Boolean(expected?.week);
    setWeekSelectorSuppressed(Boolean(expected?.week));
    if (expected?.from) {
      const from = expected.from;
      // Keep the outgoing panel until its replacement has travelled into view.
      busy.current = true;
      setDayTransition({ from: expected.from, to: date });
      addFrame(() => addFrame(() => {
        setDayAnimating(true);
        setDayDirection(date > from ? 1 : -1);
        addTimer(() => { resetPaging(); busy.current = false; }, TRANSITION_MS);
      }));
    } else if (expected?.week) {
      // The new week is committed first; only then run the v26 tap/spring handoff.
      addTimer(() => {
        weekRef.current?.tapIndex(dayIndex(date));
        setWeekSelectorSuppressed(false);
        busy.current = false;
      }, POST_WEEK_TAP_DELAY_MS);
    } else if (!expected) {
      weekRef.current?.resetIndex(dayIndex(date));
    }
    if (pendingEdit) addTimer(() => setEditingEvent(pendingEdit), 200);
  }, [date]);

  const requestDate = (next: LocalDate, week: boolean, from?: LocalDate) => {
    arrival.current = { date: next, week, from };
    latestChange.current(next);
    // Controlled callers may decline a request. Restore their value rather than
    // retaining an optimistic selection or leaving paging locked indefinitely.
    addFrame(() => {
      if (currentDate.current !== next && arrival.current?.date === next) {
        arrival.current = null;
        if (pendingEditingEvent.current?.date === next) pendingEditingEvent.current = null;
        resetPaging();
        setWeekSelectorSuppressed(false);
        busy.current = false;
        weekRef.current?.resetIndex(dayIndex(currentDate.current));
      }
    });
  };

  const chooseWeekDay = (index: number) => {
    if (busy.current) return;
    const next = addDays(startOfWeek(currentDate.current), index);
    weekRef.current?.tapIndex(index);
    if (next !== currentDate.current) requestDate(next, false, currentDate.current);
  };

  const finishWeekPage = (direction: -1 | 1, targetDate: LocalDate) => {
    busy.current = true;
    setWeekAnimating(true);
    setWeekDirection(direction);
    setWeekSelectorSuppressed(true);
    addTimer(() => {
      resetPaging();
      requestDate(targetDate, true);
    }, TRANSITION_MS);
  };

  const startDayCommit = (direction: -1 | 1) => {
    const next = addDays(currentDate.current, direction);
    busy.current = true;
    setDayAnimating(true);
    setDayDirection(direction);
    if (!sameWeek(currentDate.current, next)) {
      finishWeekPage(direction, next);
      return;
    }
    weekRef.current?.selectIndex(dayIndex(next));
    addTimer(() => {
      resetPaging();
      requestDate(next, false);
    }, TRANSITION_MS);
  };

  const beginGesture = (event: ReactPointerEvent<HTMLElement>, target: 'week' | 'day') => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    if (!event.isPrimary && event.nativeEvent.isPrimary === false) return;
    if (busy.current || eventDragActive.current || weekGesture.current || dayGesture.current) return;
    const targetElement = event.target instanceof Element ? event.target : null;
    const draggableHandle = targetElement?.closest('[data-ui-dnd-handle]') ?? null;
    const interactiveTarget = targetElement?.closest('button, a, input, select, textarea, [role="button"], [data-no-dnd], [data-schedule-no-swipe]') ?? null;
    const startsOnDraggableEvent = target === 'day'
      && event.pointerType === 'touch'
      && Boolean(draggableHandle);
    const startsOnInteractiveChild = target === 'day'
      && Boolean(interactiveTarget)
      && interactiveTarget !== draggableHandle;
    if (startsOnInteractiveChild && !startsOnDraggableEvent) return;
    const state: DragState = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      deltaX: 0,
      startedAt: performance.now(),
      dragging: false,
      verticalScrolling: false,
      manualScroll: startsOnDraggableEvent,
      verticalOnly: startsOnDraggableEvent && startsOnInteractiveChild,
      startScrollTop: target === 'day' ? dayViewportRef.current?.scrollTop ?? 0 : 0,
      activationThreshold: startsOnDraggableEvent ? SCHEDULE_TOUCH_ACTIVATION_TOLERANCE : 8,
    };
    if (target === 'week') {
      weekGesture.current = state;
      setWeekSelectorSuppressed(true);
    } else {
      dayGesture.current = state;
    }
    try {
      if (target === 'week') event.currentTarget.setPointerCapture?.(event.pointerId);
    } catch {
      // Pointer capture is optional in Telegram WebViews; document listeners are not required here.
    }
  };

  const moveGesture = (event: ReactPointerEvent<HTMLElement>, target: 'week' | 'day') => {
    const state = target === 'week' ? weekGesture.current : dayGesture.current;
    if (!state || state.pointerId !== event.pointerId) return;
    const dx = event.clientX - state.startX;
    const dy = event.clientY - state.startY;

    if (!state.dragging && !state.verticalScrolling) {
      if (state.manualScroll) {
        if (Math.hypot(dx, dy) <= state.activationThreshold) return;
        if (Math.abs(dy) > Math.abs(dx)) state.verticalScrolling = true;
        else if (state.verticalOnly) return;
        else state.dragging = true;
      } else {
        if (Math.abs(dx) < state.activationThreshold || Math.abs(dx) <= Math.abs(dy)) return;
        state.dragging = true;
      }

      if (target === 'day') suppressDayClickUntil.current = performance.now() + 500;
      try { event.currentTarget.setPointerCapture?.(event.pointerId); } catch { /* Optional in WebViews. */ }
    }

    event.preventDefault();

    if (state.verticalScrolling) {
      const viewport = dayViewportRef.current;
      if (viewport) viewport.scrollTop = state.startScrollTop - dy;
      return;
    }

    state.deltaX = dx;
    if (target === 'week') setWeekDrag(dx);
    else setDayDrag(dx);
  };

  const endGesture = (
    event: ReactPointerEvent<HTMLElement>,
    target: 'week' | 'day',
    cancelled = false,
  ) => {
    const ref = target === 'week' ? weekGesture : dayGesture;
    const state = ref.current;
    if (!state || state.pointerId !== event.pointerId) return;
    ref.current = null;

    if (state.verticalScrolling) {
      if (target === 'day') suppressDayClickUntil.current = performance.now() + 500;
      return;
    }

    if (!state.dragging) {
      if (target === 'week') {
        setWeekSelectorSuppressed(false);
        if (!cancelled) {
          const rect = event.currentTarget.getBoundingClientRect();
          const contentWidth = rect.width - 24; // 12 px gutter on each week page.
          if (contentWidth > 0) chooseWeekDay(Math.max(0, Math.min(6, Math.floor((event.clientX - rect.left - 12) / (contentWidth / 7)))));
        }
      }
      return;
    }

    if (target === 'day') suppressDayClickUntil.current = performance.now() + 500;
    const viewport = target === 'week' ? weekViewportRef.current : dayViewportRef.current;
    const width = viewport?.clientWidth ?? 1;
    const elapsed = Math.max(1, performance.now() - state.startedAt);
    const velocity = state.deltaX / elapsed;
    const threshold = width * (target === 'week' ? WEEK_SWIPE_THRESHOLD : DAY_SWIPE_THRESHOLD);
    const shouldCommit = !cancelled && (Math.abs(state.deltaX) > threshold || Math.abs(velocity) > 0.45);

    if (!shouldCommit) {
      busy.current = true;
      if (target === 'week') {
        setWeekAnimating(true);
        setWeekDirection(0);
        weekDrag.current = 0;
        addTimer(() => {
          setWeekAnimating(false);
          setWeekSelectorSuppressed(false);
          busy.current = false;
        }, TRANSITION_MS);
      } else {
        setDayAnimating(true);
        setDayDirection(0);
        dayDrag.current = 0;
        addTimer(() => { setDayAnimating(false); busy.current = false; }, TRANSITION_MS);
      }
      return;
    }

    const direction: -1 | 1 = state.deltaX < 0 ? 1 : -1;
    if (target === 'week') {
      const next = addDays(currentDate.current, direction * 7);
      setDayTransition({ from: currentDate.current, to: next });
      setDayAnimating(true);
      setDayDirection(direction);
      finishWeekPage(direction, next);
    }
    else startDayCommit(direction);
  };

  const clearDragRepeatTimer = () => {
    if (dragRepeatTimer.current !== null) {
      window.clearTimeout(dragRepeatTimer.current);
      dragRepeatTimer.current = null;
    }
  };

  const pointerStartX = (event: Event): number | null => {
    if ('clientX' in event && typeof event.clientX === 'number') return event.clientX;
    if ('touches' in event && 'changedTouches' in event) {
      const touchEvent = event as Event & { touches: TouchList; changedTouches: TouchList };
      return touchEvent.touches[0]?.clientX ?? touchEvent.changedTouches[0]?.clientX ?? null;
    }
    return null;
  };

  const clearEventDrag = () => {
    eventDragActive.current = false;
    activeEventDragRef.current = null;
    activeEventEntryRef.current = null;
    dragPointerStartX.current = null;
    dragEdgeDirection.current = 0;
    dragPageDateRef.current = null;
    dragTargetDateRef.current = null;
    dragPageAnimatingRef.current = false;
    clearDragRepeatTimer();
    if (dayTrackRef.current) {
      dayTrackRef.current.style.transition = 'none';
      dayTrackRef.current.style.transform = 'translate3d(-33.333333%,0,0)';
    }
    if (dayViewportRef.current) dayViewportRef.current.scrollLeft = 0;
    setDragPageDate(null);
    setDragWeekDate(null);
    setDragPageDirection(0);
    setDragPageAnimating(false);
    setActiveEventDragId(null);
  };

  const scheduleRepeatedDragPage = () => {
    clearDragRepeatTimer();
    dragRepeatTimer.current = window.setTimeout(() => {
      dragRepeatTimer.current = null;
      if (!eventDragActive.current || dragPageAnimatingRef.current) return;
      const direction = dragEdgeDirection.current;
      if (direction !== 0) triggerDragPage(direction);
    }, DRAG_DAY_REPEAT_PAUSE_MS);
  };

  const triggerDragPage = (direction: -1 | 1) => {
    if (!eventDragActive.current || dragPageAnimatingRef.current) return;
    const current = dragPageDateRef.current;
    if (!current) return;
    const target = addDays(current, direction);
    dragPageAnimatingRef.current = true;
    dragTargetDateRef.current = target;
    setDragWeekDate(target);
    setDragPageDirection(direction);
    setDragPageAnimating(true);
    addFrame(() => weekRef.current?.tapIndex(dayIndex(target)));

    addTimer(() => {
      if (!eventDragActive.current) return;
      if (dayTrackRef.current) {
        dayTrackRef.current.style.transition = 'none';
        dayTrackRef.current.style.transform = 'translate3d(-33.333333%,0,0)';
      }
      dragPageDateRef.current = target;
      dragTargetDateRef.current = target;
      setDragPageDate(target);
      setDragPageDirection(0);
      setDragPageAnimating(false);
      dragPageAnimatingRef.current = false;
      scheduleRepeatedDragPage();
    }, TRANSITION_MS);
  };

  const handleEventDragStart = (event: DragStartEvent) => {
    const dragId = String(event.active.id);
    const entry = dragEntries.get(dragId);
    if (!onEventMove || !entry) return;
    eventDragActive.current = true;
    dayGesture.current = null;
    setDayDrag(0);
    clearDragRepeatTimer();
    dragPointerStartX.current = pointerStartX(event.activatorEvent);
    dragEdgeDirection.current = 0;
    dragPageDateRef.current = entry.date;
    dragTargetDateRef.current = entry.date;
    activeEventEntryRef.current = entry;
    setDragPageDate(entry.date);
    setDragWeekDate(entry.date);
    setDragPageDirection(0);
    setDragPageAnimating(false);
    if (dayViewportRef.current) dayViewportRef.current.scrollLeft = 0;
    suppressDayClickUntil.current = performance.now() + 500;
    activeEventDragRef.current = dragId;
    setActiveEventDragId(dragId);
  };

  const handleEventDragMove = (event: DragMoveEvent) => {
    if (!activeEventDragRef.current) return;
    const viewport = dayViewportRef.current;
    const startX = dragPointerStartX.current;
    if (!viewport || startX === null) return;
    const rect = viewport.getBoundingClientRect();
    const currentX = startX + event.delta.x;
    let edge: -1 | 0 | 1 = 0;
    if (currentX >= rect.right - DRAG_DAY_EDGE_ZONE_PX) edge = 1;
    else if (currentX <= rect.left + DRAG_DAY_EDGE_ZONE_PX) edge = -1;
    dragEdgeDirection.current = edge;

    if (edge !== 0 && !dragPageAnimatingRef.current && dragRepeatTimer.current === null) {
      triggerDragPage(edge);
    }
  };

  const handleEventDragEnd = (event: DragEndEvent) => {
    const dragId = String(event.active.id);
    const activeDragId = activeEventDragRef.current;
    const entry = activeEventEntryRef.current;
    const targetDate = dragTargetDateRef.current ?? dragPageDateRef.current ?? entry?.date ?? null;
    clearEventDrag();

    if (!onEventMove || !entry || !targetDate || activeDragId !== dragId) return;
    const startMinutes = startMinutesAfterDrag(
      entry.event.startMinutes,
      entry.event.durationMinutes,
      event.delta.y,
    );
    const fits = eventFitsSlot(
      eventsByDate[targetDate] ?? [],
      entry.event.id,
      startMinutes,
      entry.event.durationMinutes,
    );
    const movedDay = targetDate !== entry.date;
    const acceptedMove = fits && (movedDay || startMinutes !== entry.event.startMinutes);

    if (acceptedMove) {
      onEventMove({
        eventId: entry.event.id,
        date: entry.date,
        targetDate,
        previousStartMinutes: entry.event.startMinutes,
        startMinutes,
      });
    }

    if (acceptedMove && movedDay) {
      if (onEventResize) pendingEditingEvent.current = { date: targetDate, eventId: entry.event.id };
      latestChange.current(targetDate);
      return;
    }

    if (onEventResize) {
      addTimer(() => setEditingEvent({ date: entry.date, eventId: entry.event.id }), 200);
    }
  };

  const handleEventResize = (entryDate: LocalDate, event: TEvent, startMinutes: number, durationMinutes: number) => {
    if (!onEventResize) return;
    if (!eventFitsSlot(eventsByDate[entryDate] ?? [], event.id, startMinutes, durationMinutes)) return;
    onEventResize({
      eventId: event.id,
      date: entryDate,
      previousStartMinutes: event.startMinutes,
      previousDurationMinutes: event.durationMinutes,
      startMinutes,
      durationMinutes,
    });
  };

  const dismissEditingOnOutsidePress = (pointerEvent: ReactPointerEvent<HTMLElement>) => {
    if (!editingEvent || !(pointerEvent.target instanceof Element)) return;
    const frame = pointerEvent.target.closest<HTMLElement>('[data-event-id][data-event-date]');
    if (frame?.dataset.eventId === editingEvent.eventId && frame.dataset.eventDate === editingEvent.date) return;
    setEditingEvent(null);
  };

  const weekTranslate = weekAnimating
    ? `calc(-33.333333% + ${weekDirection * -100 / 3}%)`
    : `calc(-33.333333% + ${weekDrag.current}px)`;
  const dayTranslate = activeEventDragId
    ? `${-33.333333 + dragPageDirection * -33.333333}%`
    : dayAnimating
      ? `${-33.333333 + dayDirection * -33.333333}%`
      : `calc(-33.333333% + ${dayDrag.current}px)`;
  const dayTrackTransition = activeEventDragId
    ? dragPageAnimating ? TRACK_TRANSITION : 'none'
    : dayAnimating
      ? TRACK_TRANSITION
      : 'none';

  const schedule = (
    <section
      className={['ui-day-schedule', activeEventDragId ? 'ui-day-schedule--event-dragging' : '', editingEvent ? 'ui-day-schedule--event-editing' : '', className].filter(Boolean).join(' ')}
      onPointerDownCapture={dismissEditingOnOutsidePress}
    >
      <div
        className="ui-day-schedule__week-viewport"
        ref={weekViewportRef}
        onPointerDown={event => beginGesture(event, 'week')}
        onPointerMove={event => moveGesture(event, 'week')}
        onPointerUp={event => endGesture(event, 'week')}
        onPointerCancel={event => endGesture(event, 'week', true)}
        onLostPointerCapture={event => { if (event.target === event.currentTarget) endGesture(event, 'week', true); }}
        onClickCapture={event => {
          if (event.detail > 0) { event.preventDefault(); event.stopPropagation(); }
        }}
      >
        <div
          ref={weekTrackRef}
          className={`ui-day-schedule__week-track${weekAnimating ? ' ui-day-schedule__week-track--animating' : ''}`}
          style={{ transition: weekAnimating ? TRACK_TRANSITION : 'none', transform: `translate3d(${weekTranslate},0,0)` }}
        >
          <div className="ui-day-schedule__week-page">
            <WeekScene monday={previousMonday} selectedIndex={selectedIndex} preview />
          </div>
          <div className="ui-day-schedule__week-page">
            <WeekScene
              ref={weekRef}
              monday={monday}
              selectedIndex={selectedIndex}
              suppressSelector={weekSelectorSuppressed}
              onSelect={chooseWeekDay}
            />
          </div>
          <div className="ui-day-schedule__week-page">
            <WeekScene monday={nextMonday} selectedIndex={selectedIndex} preview />
          </div>
        </div>
      </div>

      <div
        className="ui-day-schedule__day-viewport"
        ref={dayViewportRef}
        onPointerDown={event => beginGesture(event, 'day')}
        onPointerMove={event => moveGesture(event, 'day')}
        onPointerUp={event => endGesture(event, 'day')}
        onPointerCancel={event => endGesture(event, 'day', true)}
        onLostPointerCapture={event => { if (event.target === event.currentTarget) endGesture(event, 'day', true); }}
        onClickCapture={event => {
          if (performance.now() < suppressDayClickUntil.current) { event.preventDefault(); event.stopPropagation(); }
        }}
      >
        <div
          ref={dayTrackRef}
          className={`ui-day-schedule__day-track${dayAnimating ? ' ui-day-schedule__day-track--animating' : ''}`}
          style={{ transition: dayTrackTransition, transform: `translate3d(${dayTranslate},0,0)` }}
        >
          <DayPanel
            date={previousDate}
            events={eventsByDate[previousDate] ?? []}
            renderEvent={renderEvent}
            today={today}
            nowMinutes={now.getHours() * 60 + now.getMinutes()}
            draggableEvents={Boolean(onEventMove) && !dayAnimating && !weekAnimating}
            editingEventId={editingEvent?.date === previousDate ? editingEvent.eventId : undefined}
            onEventResize={onEventResize ? (event, startMinutes, durationMinutes) => handleEventResize(previousDate, event, startMinutes, durationMinutes) : undefined}
          />
          <DayPanel
            date={displayDate}
            events={eventsByDate[displayDate] ?? []}
            renderEvent={renderEvent}
            today={today}
            nowMinutes={now.getHours() * 60 + now.getMinutes()}
            draggableEvents={Boolean(onEventMove) && !dayAnimating && !weekAnimating}
            editingEventId={editingEvent?.date === displayDate ? editingEvent.eventId : undefined}
            onEventResize={onEventResize ? (event, startMinutes, durationMinutes) => handleEventResize(displayDate, event, startMinutes, durationMinutes) : undefined}
          />
          <DayPanel
            date={nextDate}
            events={eventsByDate[nextDate] ?? []}
            renderEvent={renderEvent}
            today={today}
            nowMinutes={now.getHours() * 60 + now.getMinutes()}
            draggableEvents={Boolean(onEventMove) && !dayAnimating && !weekAnimating}
            editingEventId={editingEvent?.date === nextDate ? editingEvent.eventId : undefined}
            onEventResize={onEventResize ? (event, startMinutes, durationMinutes) => handleEventResize(nextDate, event, startMinutes, durationMinutes) : undefined}
          />
        </div>
      </div>
    </section>
  );

  if (!onEventMove) return schedule;

  return (
    <DndContext
      accessibility={{ restoreFocus: false }}
      autoScroll={false}
      sensors={eventDragSensors}
      onDragStart={handleEventDragStart}
      onDragMove={handleEventDragMove}
      onDragCancel={clearEventDrag}
      onDragEnd={handleEventDragEnd}
    >
      {schedule}
      <DragOverlay
        className="ui-day-schedule__drag-overlay-wrapper"
        dropAnimation={{
          duration: 200,
          easing: 'cubic-bezier(.2,.8,.2,1)',
          sideEffects: ({ active, dragOverlay }) => {
            const previousOpacity = active.node.style.opacity;
            active.node.style.opacity = '0';
            dragOverlay.node.classList.add('ui-day-schedule__drag-overlay-wrapper--dropping');
            return () => {
              active.node.style.opacity = previousOpacity;
              dragOverlay.node.classList.remove('ui-day-schedule__drag-overlay-wrapper--dropping');
            };
          },
        }}
      >
        {activeEventEntry && activeEventDragRef.current ? (
          <div className="ui-day-schedule__drag-visual" aria-hidden="true">
            <GlassSurface
              className="ui-day-schedule__drag-overlay"
              contentClassName="ui-day-schedule__drag-overlay-content"
              shape={{ radius: 14 }}
            >
              {renderEvent(activeEventEntry.event, {
                compact: activeEventEntry.compact,
                lifted: true,
                editing: false,
                height: activeEventEntry.height,
                startMinutes: activeEventEntry.event.startMinutes,
                durationMinutes: activeEventEntry.event.durationMinutes,
              })}
            </GlassSurface>
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
