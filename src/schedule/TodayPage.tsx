import { useEffect, useMemo, useRef, useState } from 'react';
import {
  cancelScheduleOccurrence,
  getScheduleOccurrences,
  rescheduleScheduleOccurrence,
  type Role,
  type ScheduleOccurrence,
} from '../api';
import { useNavigationFloatingAction, type NavigationContext } from '../NavigationShell';
import {
  Avatar,
  DaySchedule,
  DayScheduleEventCard,
  MezfitBottomSheet,
  Text,
  getDayScheduleValue,
  type DayScheduleEvent,
  type DayScheduleEventDelete,
  type DayScheduleEventMove,
  type DayScheduleEventResize,
  type LocalDate,
} from '../ui';
import './today-page.css';

const CACHE_RADIUS_DAYS = 31;

type TodayScheduleEvent = DayScheduleEvent & {
  occurrence: ScheduleOccurrence;
};

type ScheduleCreationSheet = 'workout' | 'event';

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

function occurrenceIdFromEventId(eventId: string): number | null {
  const id = Number(eventId);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function upsertOccurrence(
  current: Readonly<Record<LocalDate, readonly ScheduleOccurrence[]>>,
  occurrence: ScheduleOccurrence,
): Record<LocalDate, ScheduleOccurrence[]> {
  const next: Record<LocalDate, ScheduleOccurrence[]> = {};

  for (const [entryDate, entries] of Object.entries(current)) {
    next[entryDate as LocalDate] = entries.filter((entry) => entry.id !== occurrence.id);
  }

  const targetDate = occurrence.calendarDate as LocalDate;
  const targetEntries = next[targetDate] ?? [];
  targetEntries.push(occurrence);
  targetEntries.sort((left, right) => left.startMinute - right.startMinute || left.id - right.id);
  next[targetDate] = targetEntries;
  return next;
}

function removeOccurrence(
  current: Readonly<Record<LocalDate, readonly ScheduleOccurrence[]>>,
  occurrenceId: number,
): Record<LocalDate, ScheduleOccurrence[]> {
  return Object.fromEntries(
    Object.entries(current).map(([entryDate, entries]) => [
      entryDate,
      entries.filter((entry) => entry.id !== occurrenceId),
    ]),
  ) as Record<LocalDate, ScheduleOccurrence[]>;
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
  const [creationSheet, setCreationSheet] = useState<ScheduleCreationSheet | null>(null);
  const [occurrencesByDate, setOccurrencesByDate] = useState<Record<LocalDate, ScheduleOccurrence[]>>({});
  const [loadingToday, setLoadingToday] = useState(true);
  const [error, setError] = useState('');
  const [mutatingOccurrenceIds, setMutatingOccurrenceIds] = useState<ReadonlySet<number>>(() => new Set());
  const loadedRangesRef = useRef<DateRange[]>([]);
  const mutatingOccurrenceIdsRef = useRef<Set<number>>(new Set());
  const pendingRangesRef = useRef<DateRange[]>([]);
  const requestGenerationRef = useRef(0);
  const initialLoadSettledRef = useRef(false);

  const scheduleFloatingAction = useMemo(() => (
    role === 'coach' && creationSheet === null
      ? {
          label: 'Добавить',
          placement: 'left' as const,
          icon: 'plus' as const,
          popoverItems: [
            {
              id: 'add-workout',
              icon: 'plus' as const,
              label: 'Тренировка',
              onSelect: () => setCreationSheet('workout'),
            },
            {
              id: 'add-event',
              icon: 'plus' as const,
              label: 'Событие',
              onSelect: () => setCreationSheet('event'),
            },
          ],
        }
      : null
  ), [creationSheet, role]);
  useNavigationFloatingAction('today', scheduleFloatingAction);

  useEffect(() => {
    if (creationSheet !== null) {
      const title = creationSheet === 'workout' ? 'Тренировка' : 'Событие';
      onNavigationContextChange({
        level: 2,
        title,
        scrollKey: `schedule:create:${creationSheet}`,
        identity: { title, icon: 'plus' },
        contentMode: 'viewport',
        onBack: () => setCreationSheet(null),
      });
      return () => onNavigationContextChange(null);
    }

    const value = getDayScheduleValue(date);
    onNavigationContextChange({
      level: 1,
      title: value.title,
      identity: { title: value.title, icon: 'calendar-event' },
      calendar: { value: date, onChange: setDate },
      contentMode: 'viewport',
    });

    return () => onNavigationContextChange(null);
  }, [creationSheet, date, onNavigationContextChange]);

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
      || mutatingOccurrenceIds.size > 0
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
  }, [date, initData, loadingToday, mutatingOccurrenceIds, role]);

  const occurrenceIsEditable = (occurrence: ScheduleOccurrence): boolean => (
    occurrence.status === 'scheduled'
    && !mutatingOccurrenceIds.has(occurrence.id)
    && (
      role === 'coach'
      || (currentUserId !== undefined && occurrence.createdByUserId === currentUserId)
    )
  );

  const beginMutation = (occurrenceId: number): boolean => {
    if (mutatingOccurrenceIdsRef.current.has(occurrenceId)) return false;
    mutatingOccurrenceIdsRef.current.add(occurrenceId);
    setMutatingOccurrenceIds(new Set(mutatingOccurrenceIdsRef.current));

    // Any in-flight cache read may have been issued before this mutation and
    // must not overwrite the authoritative mutation response when it arrives.
    requestGenerationRef.current += 1;
    pendingRangesRef.current = [];
    return true;
  };

  const finishMutation = (occurrenceId: number) => {
    mutatingOccurrenceIdsRef.current.delete(occurrenceId);
    setMutatingOccurrenceIds(new Set(mutatingOccurrenceIdsRef.current));
  };

  const occurrenceForEvent = (entryDate: LocalDate, eventId: string): ScheduleOccurrence | null => {
    const occurrenceId = occurrenceIdFromEventId(eventId);
    if (occurrenceId === null) return null;
    return occurrencesByDate[entryDate]?.find((entry) => entry.id === occurrenceId) ?? null;
  };

  const handleEventMove = async (move: DayScheduleEventMove) => {
    const occurrence = occurrenceForEvent(move.date, move.eventId);
    if (!occurrence || !occurrenceIsEditable(occurrence) || !beginMutation(occurrence.id)) return;

    const optimistic: ScheduleOccurrence = {
      ...occurrence,
      calendarDate: move.targetDate,
      dateKey: Number(move.targetDate.replaceAll('-', '')),
      startMinute: move.startMinutes,
    };
    setOccurrencesByDate((current) => upsertOccurrence(current, optimistic));
    setError('');

    try {
      const result = await rescheduleScheduleOccurrence(initData, occurrence.id, {
        date: move.targetDate,
        startMinute: move.startMinutes,
        durationMinutes: occurrence.durationMinutes,
      });
      setOccurrencesByDate((current) => upsertOccurrence(current, result.occurrence));
    } catch (mutationError) {
      setOccurrencesByDate((current) => upsertOccurrence(current, occurrence));
      setError(mutationError instanceof Error ? mutationError.message : 'Не удалось перенести тренировку');
    } finally {
      finishMutation(occurrence.id);
    }
  };

  const handleEventResize = async (resize: DayScheduleEventResize) => {
    const occurrence = occurrenceForEvent(resize.date, resize.eventId);
    if (!occurrence || !occurrenceIsEditable(occurrence) || !beginMutation(occurrence.id)) return;

    const optimistic: ScheduleOccurrence = {
      ...occurrence,
      startMinute: resize.startMinutes,
      durationMinutes: resize.durationMinutes,
    };
    setOccurrencesByDate((current) => upsertOccurrence(current, optimistic));
    setError('');

    try {
      const result = await rescheduleScheduleOccurrence(initData, occurrence.id, {
        date: resize.date,
        startMinute: resize.startMinutes,
        durationMinutes: resize.durationMinutes,
      });
      setOccurrencesByDate((current) => upsertOccurrence(current, result.occurrence));
    } catch (mutationError) {
      setOccurrencesByDate((current) => upsertOccurrence(current, occurrence));
      setError(mutationError instanceof Error ? mutationError.message : 'Не удалось изменить время тренировки');
    } finally {
      finishMutation(occurrence.id);
    }
  };

  const handleEventDelete = async (deletion: DayScheduleEventDelete) => {
    const occurrence = occurrenceForEvent(deletion.date, deletion.eventId);
    if (!occurrence || !occurrenceIsEditable(occurrence) || !beginMutation(occurrence.id)) return;

    setOccurrencesByDate((current) => removeOccurrence(current, occurrence.id));
    setError('');

    try {
      await cancelScheduleOccurrence(initData, occurrence.id);
    } catch (mutationError) {
      setOccurrencesByDate((current) => upsertOccurrence(current, occurrence));
      setError(mutationError instanceof Error ? mutationError.message : 'Не удалось отменить тренировку');
    } finally {
      finishMutation(occurrence.id);
    }
  };

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
        isEventEditable={(event) => occurrenceIsEditable(event.occurrence)}
        onEventMove={(move) => { void handleEventMove(move); }}
        onEventResize={(resize) => { void handleEventResize(resize); }}
        onEventDelete={(deletion) => { void handleEventDelete(deletion); }}
        renderEvent={(event, state) => {
          const clientCreated = event.occurrence.createdByUserId === event.occurrence.client.id;
          const cardPerson = role === 'coach'
            ? event.occurrence.client
            : clientCreated
              ? event.occurrence.client
              : event.occurrence.coach;
          const cardPersonName = displayName(cardPerson);
          const title = role === 'coach' ? cardPersonName : event.occurrence.day.name;
          const detail = role === 'coach'
            ? `${event.occurrence.program.name} · ${event.occurrence.day.name}`
            : `${cardPersonName} · ${event.occurrence.program.name}`;

          return (
            <DayScheduleEventCard
              title={title}
              detail={detail}
              media={<Avatar name={cardPersonName} src={cardPerson.photoUrl ?? undefined} />}
              state={state}
            />
          );
        }}
      />

      {creationSheet === null && (loadingToday || error || notice) ? (
        <div className="today-page__status" aria-live="polite">
          <Text variant="footnote" tone="muted">
            {error || notice || 'Загружаем расписание…'}
          </Text>
        </div>
      ) : null}

      <MezfitBottomSheet
        opened={creationSheet !== null}
        label={creationSheet === 'workout' ? 'Тренировка' : 'Событие'}
        onClose={() => setCreationSheet(null)}
      />
    </section>
  );
}
