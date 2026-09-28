import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { Link, Navbar } from 'konsta/react';
import type { LocalDate } from './date-picker/datePickerDate';
import { DayPanel, type DayScheduleEventBase, type DayScheduleRenderState, yForMinutes } from './day-schedule/DayPanel';
import { addDays, currentLocalDate, dayIndex, sameWeek, startOfWeek, titleForDate } from './day-schedule/dateMath';
import { WeekScene, type WeekSceneHandle } from './day-schedule/WeekScene';
import { useScheduleClock } from './day-schedule/useScheduleClock';
import './day-schedule.css';

const WEEK_SWIPE_THRESHOLD = 0.18;
const DAY_SWIPE_THRESHOLD = 0.18;
const TRANSITION_MS = 300;
const POST_WEEK_TAP_DELAY_MS = 50;

type DragState = {
  pointerId: number;
  startX: number;
  startY: number;
  deltaX: number;
  startedAt: number;
  dragging: boolean;
};

export type DayScheduleEvent = DayScheduleEventBase;
export type { DayScheduleRenderState };

export type DayScheduleProps<TEvent extends DayScheduleEvent = DayScheduleEvent> = {
  date: LocalDate;
  eventsByDate: Readonly<Record<LocalDate, readonly TEvent[]>>;
  onDateChange: (date: LocalDate) => void;
  renderEvent: (event: TEvent, state: DayScheduleRenderState) => ReactNode;
  onBack?: () => void;
  onOpenDatePicker?: () => void;
  onAddEvent?: () => void;
  today?: LocalDate;
  className?: string;
};

function BackIcon() {
  return (
    <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m15 18-6-6 6-6" />
    </svg>
  );
}

function CalendarIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 3v3M18 3v3M4 8h16M5 5h14a1 1 0 0 1 1 1v14H4V6a1 1 0 0 1 1-1Z" />
    </svg>
  );
}

function AddIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

export function DaySchedule<TEvent extends DayScheduleEvent>({
  date,
  eventsByDate,
  onDateChange,
  renderEvent,
  onBack,
  onOpenDatePicker,
  onAddEvent,
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
  const arrival = useRef<{ date: LocalDate; week: boolean } | null>(null);

  const weekDrag = useRef(0);
  const [weekAnimating, setWeekAnimating] = useState(false);
  const [weekDirection, setWeekDirection] = useState<-1 | 0 | 1>(0);
  const [weekSelectorSuppressed, setWeekSelectorSuppressed] = useState(false);
  const dayDrag = useRef(0);
  const [dayAnimating, setDayAnimating] = useState(false);
  const [dayDirection, setDayDirection] = useState<-1 | 0 | 1>(0);

  const monday = startOfWeek(date);
  const selectedIndex = dayIndex(date);
  const previousMonday = addDays(monday, -7);
  const nextMonday = addDays(monday, 7);
  const previousDate = addDays(date, -1);
  const nextDate = addDays(date, 1);

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
    weekGesture.current = null;
    dayGesture.current = null;
    setWeekAnimating(false);
    setWeekDirection(0);
    setWeekDrag(0);
    setDayAnimating(false);
    setDayDirection(0);
    setDayDrag(0);
  };

  useLayoutEffect(() => { latestChange.current = onDateChange; }, [onDateChange]);

  useLayoutEffect(() => {
    currentDate.current = date;
    const expected = arrival.current?.date === date ? arrival.current : null;
    arrival.current = null;
    clearPending();
    resetPaging();
    busy.current = Boolean(expected?.week);
    setWeekSelectorSuppressed(Boolean(expected?.week));
    if (expected?.week) {
      // The new week is committed first; only then run the v26 tap/spring handoff.
      addTimer(() => {
        weekRef.current?.tapIndex(dayIndex(date));
        setWeekSelectorSuppressed(false);
        busy.current = false;
      }, POST_WEEK_TAP_DELAY_MS);
    } else if (!expected) {
      weekRef.current?.resetIndex(dayIndex(date));
    }
  }, [date]);

  const requestDate = (next: LocalDate, week: boolean) => {
    arrival.current = { date: next, week };
    latestChange.current(next);
    // Controlled callers may decline a request. Restore their value rather than
    // retaining an optimistic selection or leaving paging locked indefinitely.
    addFrame(() => {
      if (currentDate.current !== next && arrival.current?.date === next) {
        arrival.current = null;
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
    if (next !== currentDate.current) requestDate(next, false);
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
    if (busy.current || weekGesture.current || dayGesture.current) return;
    if (target === 'day' && event.target instanceof Element &&
      event.target.closest('button, a, input, select, textarea, [data-schedule-no-swipe]')) return;
    const state: DragState = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      deltaX: 0,
      startedAt: performance.now(),
      dragging: false,
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
    if (!state.dragging) {
      if (Math.abs(dx) < 8 || Math.abs(dx) <= Math.abs(dy)) return;
      state.dragging = true;
      if (target === 'day') suppressDayClickUntil.current = performance.now() + 500;
      try { event.currentTarget.setPointerCapture?.(event.pointerId); } catch { /* Optional in WebViews. */ }
    }
    event.preventDefault();
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

    if (!state.dragging) {
      if (target === 'week') {
        setWeekSelectorSuppressed(false);
        if (!cancelled) {
          const rect = event.currentTarget.getBoundingClientRect();
          if (rect.width > 0) chooseWeekDay(Math.max(0, Math.min(6, Math.floor((event.clientX - rect.left) / (rect.width / 7)))));
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
        setWeekDrag(0);
        addTimer(() => {
          setWeekAnimating(false);
          setWeekSelectorSuppressed(false);
          busy.current = false;
        }, TRANSITION_MS);
      } else {
        setDayAnimating(true);
        setDayDirection(0);
        setDayDrag(0);
        addTimer(() => { setDayAnimating(false); busy.current = false; }, TRANSITION_MS);
      }
      return;
    }

    const direction: -1 | 1 = state.deltaX < 0 ? 1 : -1;
    if (target === 'week') finishWeekPage(direction, addDays(currentDate.current, direction * 7));
    else startDayCommit(direction);
  };

  const weekTranslate = weekAnimating
    ? `calc(-33.333333% + ${weekDirection * -100 / 3}%)`
    : `calc(-33.333333% + ${weekDrag.current}px)`;
  const dayTranslate = dayAnimating
    ? `${-33.333333 + dayDirection * -33.333333}%`
    : `calc(-33.333333% + ${dayDrag.current}px)`;

  const leftAction = onBack ? (
    <Link component="button" iconOnly aria-label="Назад" onClick={onBack}>
      <BackIcon />
    </Link>
  ) : null;
  const rightAction = (
    <div className="ui-day-schedule__navbar-actions">
      {onOpenDatePicker && (
        <Link component="button" iconOnly aria-label="Открыть календарь" onClick={onOpenDatePicker}>
          <CalendarIcon />
        </Link>
      )}
      {onAddEvent && (
        <Link component="button" iconOnly aria-label="Добавить тренировку" onClick={onAddEvent}>
          <AddIcon />
        </Link>
      )}
    </div>
  );

  return (
    <section className={['ui-day-schedule', className].filter(Boolean).join(' ')}>
      <Navbar
        className="ui-day-schedule__navbar"
        centerTitle
        outline={false}
        title={titleForDate(date, today)}
        left={leftAction}
        right={rightAction}
      />

      <div
        className="ui-day-schedule__week-viewport"
        ref={weekViewportRef}
        onPointerDown={event => beginGesture(event, 'week')}
        onPointerMove={event => moveGesture(event, 'week')}
        onPointerUp={event => endGesture(event, 'week')}
        onPointerCancel={event => endGesture(event, 'week', true)}
        onLostPointerCapture={event => endGesture(event, 'week', true)}
        onClickCapture={event => {
          if (event.detail > 0) { event.preventDefault(); event.stopPropagation(); }
        }}
      >
        <div
          ref={weekTrackRef}
          className={`ui-day-schedule__week-track${weekAnimating ? ' ui-day-schedule__week-track--animating' : ''}`}
          style={{ transform: `translate3d(${weekTranslate},0,0)` }}
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
        onLostPointerCapture={event => endGesture(event, 'day', true)}
        onClickCapture={event => {
          if (performance.now() < suppressDayClickUntil.current) { event.preventDefault(); event.stopPropagation(); }
        }}
      >
        <div
          ref={dayTrackRef}
          className={`ui-day-schedule__day-track${dayAnimating ? ' ui-day-schedule__day-track--animating' : ''}`}
          style={{ transform: `translate3d(${dayTranslate},0,0)` }}
        >
          <DayPanel date={previousDate} events={eventsByDate[previousDate] ?? []} renderEvent={renderEvent} today={today} nowMinutes={now.getHours() * 60 + now.getMinutes()} />
          <DayPanel date={date} events={eventsByDate[date] ?? []} renderEvent={renderEvent} today={today} nowMinutes={now.getHours() * 60 + now.getMinutes()} />
          <DayPanel date={nextDate} events={eventsByDate[nextDate] ?? []} renderEvent={renderEvent} today={today} nowMinutes={now.getHours() * 60 + now.getMinutes()} />
        </div>
      </div>
    </section>
  );
}

