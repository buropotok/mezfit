import { useEffect, useMemo, useRef, useState } from 'react';
import {
  getScheduleOccurrences,
  type Role,
  type ScheduleOccurrence,
} from '../api';
import type { NavigationContext } from '../NavigationShell';
import {
  Avatar,
  DaySchedule,
  DayScheduleEventCard,
  Text,
  getDayScheduleValue,
  type DayScheduleEvent,
  type LocalDate,
} from '../ui';
import './today-page.css';

const CACHE_RADIUS_DAYS = 31;

type TodayScheduleEvent = DayScheduleEvent & {
  occurrence: ScheduleOccurrence;
};

type DateRange = {
  from: LocalDate;
  to: LocalDate;
};

function currentLocalDate(): LocalDate {
  const now = new Date();
  const year = String(now.getFullYear()).padStart(4, '0');
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function addLocalDays(value: LocalDate, amount: number): LocalDate {
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + amount);
  const nextYear = String(date.getUTCFullYear()).padStart(4, '0');
  const nextMonth = String(date.getUTCMonth() + 1).padStart(2, '0');
  const nextDay = String(date.getUTCDate()).padStart(2, '0');
  return `${nextYear}-${nextMonth}-${nextDay}` as LocalDate;
}

function includesDate(ranges: readonly DateRange[], date: LocalDate): boolean {
  return ranges.some((range) => range.from <= date && date <= range.to);
}

function addLoadedRange(ranges: readonly DateRange[], next: DateRange): DateRange[] {
  const untouched: DateRange[] = [];
  let merged = { ...next };

  for (const range of ranges) {
    if (range.to < merged.from || range.from > merged.to) {
      untouched.push(range);
      continue;
    }
    merged = {
      from: range.from < merged.from ? range.from : merged.from,
      to: range.to > merged.to ? range.to : merged.to,
    };
  }

  return [...untouched, merged];
}

function removePendingRange(ranges: readonly DateRange[], target: DateRange): DateRange[] {
  return ranges.filter((range) => range.from !== target.from || range.to !== target.to);
}

function replaceRange(
  current: Readonly<Record<LocalDate, readonly ScheduleOccurrence[]>>,
  range: DateRange,
  occurrences: readonly ScheduleOccurrence[],
): Record<LocalDate, ScheduleOccurrence[]> {
  const next: Record<LocalDate, ScheduleOccurrence[]> = {};

  for (const [date, entries] of Object.entries(current)) {
    if (date < range.from || date > range.to) {
      next[date as LocalDate] = [...entries];
    }
  }

  for (const occurrence of occurrences) {
    const date = occurrence.calendarDate as LocalDate;
    const entries = next[date] ?? [];
    entries.push(occurrence);
    entries.sort((left, right) => left.startMinute - right.startMinute || left.id - right.id);
    next[date] = entries;
  }

  return next;
}

function displayName(person: ScheduleOccurrence['coach']): string {
  return [person.firstName, person.lastName].filter(Boolean).join(' ') || person.username || 'Mezfit';
}

export function TodayPage({
  initData,
  role,
  currentUserId,
  onNavigationContextChange,
  notice = '',
}: {
  initData: string;
  role: Role;
  currentUserId?: number;
  onNavigationContextChange: (context: NavigationContext | null) => void;
  notice?: string;
}) {
  const [date, setDate] = useState<LocalDate>(() => currentLocalDate());
  const [occurrencesByDate, setOccurrencesByDate] = useState<Record<LocalDate, ScheduleOccurrence[]>>({});
  const [loadingToday, setLoadingToday] = useState(true);
  const [error, setError] = useState('');
  const loadedRangesRef = useRef<DateRange[]>([]);
  const pendingRangesRef = useRef<DateRange[]>([]);
  const requestGenerationRef = useRef(0);
  const initialLoadSettledRef = useRef(false);

  useEffect(() => {
    const value = getDayScheduleValue(date);
    onNavigationContextChange({
      level: 1,
      title: value.title,
      identity: { title: value.title, icon: 'calendar-event' },
      calendar: { value: date, onChange: setDate },
      contentMode: 'viewport',
    });

    return () => onNavigationContextChange(null);
  }, [date, onNavigationContextChange]);

  useEffect(() => {
    const generation = requestGenerationRef.current + 1;
    requestGenerationRef.current = generation;
    const controller = new AbortController();
    const today = currentLocalDate();
    const todayRange = { from: today, to: today };
    const windowRange = {
      from: addLocalDays(today, -CACHE_RADIUS_DAYS),
      to: addLocalDays(today, CACHE_RADIUS_DAYS),
    };

    setDate(today);
    setOccurrencesByDate({});
    setError('');
    setLoadingToday(true);
    loadedRangesRef.current = [];
    pendingRangesRef.current = [];
    initialLoadSettledRef.current = false;

    const load = async () => {
      try {
        const { occurrences } = await getScheduleOccurrences(
          initData,
          role,
          today,
          today,
          controller.signal,
        );
        if (controller.signal.aborted || requestGenerationRef.current !== generation) return;
        setOccurrencesByDate((current) => replaceRange(current, todayRange, occurrences));
        loadedRangesRef.current = addLoadedRange(loadedRangesRef.current, todayRange);
      } catch (loadError) {
        if (controller.signal.aborted) return;
        setError(loadError instanceof Error ? loadError.message : 'Не удалось загрузить расписание');
      } finally {
        if (!controller.signal.aborted && requestGenerationRef.current === generation) {
          setLoadingToday(false);
          initialLoadSettledRef.current = true;
        }
      }

      if (controller.signal.aborted || requestGenerationRef.current !== generation) return;
      pendingRangesRef.current = addLoadedRange(pendingRangesRef.current, windowRange);

      try {
        const { occurrences } = await getScheduleOccurrences(
          initData,
          role,
          windowRange.from,
          windowRange.to,
          controller.signal,
        );
        if (controller.signal.aborted || requestGenerationRef.current !== generation) return;
        setOccurrencesByDate((current) => replaceRange(current, windowRange, occurrences));
        loadedRangesRef.current = addLoadedRange(loadedRangesRef.current, windowRange);
        setError('');
      } catch (loadError) {
        if (controller.signal.aborted) return;
        setError(loadError instanceof Error ? loadError.message : 'Не удалось загрузить календарь');
      } finally {
        pendingRangesRef.current = removePendingRange(pendingRangesRef.current, windowRange);
      }
    };

    void load();
    return () => controller.abort();
  }, [initData, role]);

  useEffect(() => {
    if (
      !initialLoadSettledRef.current
      || includesDate(loadedRangesRef.current, date)
      || includesDate(pendingRangesRef.current, date)
    ) return undefined;

    const generation = requestGenerationRef.current;
    const controller = new AbortController();
    const range = {
      from: addLocalDays(date, -CACHE_RADIUS_DAYS),
      to: addLocalDays(date, CACHE_RADIUS_DAYS),
    };
    pendingRangesRef.current = addLoadedRange(pendingRangesRef.current, range);

    getScheduleOccurrences(initData, role, range.from, range.to, controller.signal)
      .then(({ occurrences }) => {
        if (controller.signal.aborted || requestGenerationRef.current !== generation) return;
        setOccurrencesByDate((current) => replaceRange(current, range, occurrences));
        loadedRangesRef.current = addLoadedRange(loadedRangesRef.current, range);
        setError('');
      })
      .catch((loadError: unknown) => {
        if (controller.signal.aborted) return;
        setError(loadError instanceof Error ? loadError.message : 'Не удалось загрузить календарь');
      })
      .finally(() => {
        pendingRangesRef.current = removePendingRange(pendingRangesRef.current, range);
      });

    return () => controller.abort();
  }, [date, initData, loadingToday, role]);

  const eventsByDate = useMemo<Record<LocalDate, TodayScheduleEvent[]>>(() => (
    Object.fromEntries(
      Object.entries(occurrencesByDate).map(([entryDate, occurrences]) => [
        entryDate,
        occurrences.map((occurrence) => ({
          id: String(occurrence.id),
          startMinutes: occurrence.startMinute,
          durationMinutes: occurrence.durationMinutes,
          occurrence,
        })),
      ]),
    ) as Record<LocalDate, TodayScheduleEvent[]>
  ), [occurrencesByDate]);

  return (
    <section className="today-page" aria-label="Расписание" aria-busy={loadingToday || undefined}>
      <DaySchedule
        className="today-page__schedule"
        date={date}
        eventsByDate={eventsByDate}
        onDateChange={setDate}
        isEventEditable={(event) => (
          event.occurrence.status === 'scheduled'
          && (
            role === 'coach'
            || (currentUserId !== undefined && event.occurrence.createdByUserId === currentUserId)
          )
        )}
        renderEvent={(event, state) => {
          const otherPerson = role === 'coach' ? event.occurrence.client : event.occurrence.coach;
          const otherPersonName = displayName(otherPerson);
          const title = role === 'coach' ? otherPersonName : event.occurrence.day.name;
          const detail = role === 'coach'
            ? `${event.occurrence.program.name} · ${event.occurrence.day.name}`
            : `${otherPersonName} · ${event.occurrence.program.name}`;

          return (
            <DayScheduleEventCard
              title={title}
              detail={detail}
              media={<Avatar name={otherPersonName} src={otherPerson.photoUrl ?? undefined} />}
              state={state}
            />
          );
        }}
      />

      {loadingToday || error || notice ? (
        <div className="today-page__status" aria-live="polite">
          <Text variant="footnote" tone="muted">
            {error || notice || 'Загружаем расписание…'}
          </Text>
        </div>
      ) : null}
    </section>
  );
}
