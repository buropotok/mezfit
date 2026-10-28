import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Role } from '../api';
import { useNavigationSurfaceFloatingAction, type NavigationContext } from '../NavigationShell';
import { useCloudConnections } from '../data/cloud/CloudConnectionsProvider';
import { WorkoutOccurrenceDraftRepository } from '../data/cloud/workout-occurrence-drafts';
import { WorkoutPlanningRepository } from '../data/cloud/workout-planning';
import { PersonalEventRepository } from '../data/cloud/personal-events';
import { PersonalEventSheet } from './PersonalEventSheet';
import { ScheduleWorkoutCreator } from './ScheduleWorkoutCreator';
import { ProgramManagementRepository } from '../data/cloud/program-management';
import { draftFromOccurrence } from '../data/cloud/workout-occurrence-plan';
import { bookingsShareParticipant } from '../data/cloud/workout-slot-validation';
import type { ProgramActor } from '../program/ProgramSummary';
import { useWorkoutPerson } from './WorkoutPerson';
import type { LocalWorkoutOccurrenceDraft } from '../data/cloud/workout-occurrence-plan';
import type { CloudWorkoutOccurrenceRow } from '../data/cloud/workout-foundation-types';
import { Badge, DaySchedule, DayScheduleEventCard, Text, getDayScheduleValue,
  Icon, LiquidCollapse, type LiquidCollapseBounds, type DayScheduleEvent, type LocalDate, type LocalTime } from '../ui';
import { useSchedulePlanning } from './SchedulePlanningContext';
import { usePlannedWorkoutStart } from '../workout/PlannedWorkoutStartContext';
import { OccurrenceDraftSheet } from './OccurrenceDraftSheet';
import { ScheduleFilterBar } from './ScheduleFilterBar';
import { ScheduleActionButton } from './ScheduleActionButton';
import { ScheduleClientFilter } from './ScheduleClientFilter';
import { calendarSegments, calendarTime, localScheduleInstant } from './calendar-time';
import { CalendarSessionSheet } from './CalendarSessionSheet';
import type { CalendarWorkoutSession } from '../data/cloud/adhoc-workouts';
import { sessionTiming } from '../workout/session-timing';
import { useSessionClock } from '../workout/useSessionClock';
import './today-page.css';

type TimelineItem = DayScheduleEvent & { date: string } & (
  | { type: 'draft'; draft: LocalWorkoutOccurrenceDraft }
  | { type: 'occurrence'; occurrence: CloudWorkoutOccurrenceRow }
  | { type: 'session'; session: CalendarWorkoutSession; timeLabel: string }
);

function datePart(instant: string): LocalDate {
  const date = new Date(instant);
  const parts = [date.getFullYear(), date.getMonth() + 1, date.getDate()];
  return parts.map((value, i) => String(value).padStart(i === 0 ? 4 : 2, '0')).join('-') as LocalDate;
}
function currentDate(): LocalDate { return datePart(new Date().toISOString()); }

function timelineEvents(
  row: LocalWorkoutOccurrenceDraft | CloudWorkoutOccurrenceRow, type: 'draft' | 'occurrence',
): TimelineItem[] {
  return calendarSegments(row.startsAtUtc, row.durationMinutes).map((segment, index) => {
    const base = { ...segment, id: `${type}:${row.id}:${index}` };
    return type === 'draft' ? { ...base, type, draft: row as LocalWorkoutOccurrenceDraft }
      : { ...base, type, occurrence: row as CloudWorkoutOccurrenceRow };
  });
}

function sessionEvents(session: CalendarWorkoutSession, now: number): TimelineItem[] {
  const timing = sessionTiming(session, now);
  let boundary = Date.parse(session.startedAt);
  return calendarSegments(timing.startsAtUtc, timing.durationMinutes).map((segment, index): TimelineItem => {
    boundary += segment.durationMinutes * 60_000;
    const until = Math.min(Date.parse(timing.endsAtUtc), boundary);
    const startLabel = `${String(Math.floor(segment.startMinutes / 60)).padStart(2, '0')}:${String(segment.startMinutes % 60).padStart(2, '0')}`;
    const endLabel = segment.startMinutes + segment.durationMinutes >= 1440 ? '24:00' : calendarTime(new Date(until));
    return { ...segment, id: `session:${session.id}:${index}`, type: 'session', session,
      timeLabel: `${startLabel}–${session.status === 'active' ? '…' : endLabel}` };
  });
}
function booking(event: TimelineItem) {
  if (event.type === 'draft') return event.draft;
  if (event.type === 'occurrence') return event.occurrence;
  return { ...event.session, startsAtUtc: event.session.startedAt, durationMinutes: event.durationMinutes };
}

function BookingCard({ event, state, actor, onClick }: {
  event: TimelineItem; state: Parameters<typeof DayScheduleEventCard>[0]['state'];
  actor?: ProgramActor; onClick: () => void;
}) {
  const row = booking(event);
  const person = useWorkoutPerson(row.athleteUserId, row.realmId, actor);
  const cancelled = event.type === 'occurrence' && Boolean(event.occurrence.cancelledAt || event.occurrence.status === 'cancelled');
  const personalEvent = event.type === 'occurrence' && event.occurrence.entryKind === 'personal_event';
  const name = event.type === 'session' ? event.session.name : event.type === 'draft' ? event.draft.plan.name : event.occurrence.plan.name;
  const comment = event.type === 'occurrence' ? event.occurrence.plan.comment : null;
  return <DayScheduleEventCard title={personalEvent ? name : person.name}
    detail={personalEvent ? comment : name} media={personalEvent ? undefined : person.avatar}
    cancelled={cancelled} variant={personalEvent ? 'event' : 'workout'}
    corner={<Icon name={personalEvent ? 'calendar-event' : row.format === 'coached' ? 'users' : 'user'} />}
    cornerSize={32}
    status={event.type === 'session' ? <Badge textVariant="caption">{event.session.status === 'completed' ? 'Завершена' : 'Запущена'}</Badge>
      : cancelled ? <Badge textVariant="caption">Отменена</Badge> : event.type === 'draft' ? <Badge color="yellow" textVariant="caption">Черновик</Badge> : undefined}
    compactStatus={event.type === 'session' ? event.session.status === 'completed' ? 'Завершена' : 'Запущена'
      : cancelled ? 'Отменена' : event.type === 'draft' ? 'Черновик' : undefined}
    timeLabel={event.type === 'session' ? event.timeLabel : undefined}
    state={state} onClick={onClick} />;
}

export function TodayPage({
  initData, role, onNavigationContextChange, notice = '', actor,
}: {
  initData: string;
  role: Role;
  currentUserId?: number;
  actor?: ProgramActor;
  onNavigationContextChange: (context: NavigationContext | null) => void;
  notice?: string;
}) {
  const cloud = useCloudConnections();
  const plannedStart = usePlannedWorkoutStart();
  const planning = useSchedulePlanning();
  const [clientUserIds, setClientUserIds] = useState<string[]>([]);
  const [filterOpened, setFilterOpened] = useState(false);
  const [creation, setCreation] = useState<'workout' | 'event' | null>(null);
  const [personalEventId, setPersonalEventId] = useState<string | null>(null);
  const [creationNotice, setCreationNotice] = useState('');
  const [editorNavigation, setEditorNavigation] = useState<NavigationContext | null>(null);
  const closeCreation = useCallback(() => setCreation(null), []);
  const planner = useMemo(() => cloud ? new WorkoutPlanningRepository(cloud.db, cloud.actorUserId) : null,
    [cloud?.db, cloud?.actorUserId]);
  const personalEvents = useMemo(() => cloud ? new PersonalEventRepository(cloud.db, cloud.actorUserId) : null,
    [cloud?.db, cloud?.actorUserId]);
  const clients = useMemo(() => [...new Map((cloud?.clients ?? []).map(client => [client.userId, client])).values()], [cloud?.clients]);
  const [date, setDate] = useState<LocalDate>(currentDate);
  const [sessions, setSessions] = useState<CalendarWorkoutSession[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const now = useSessionClock(sessions.some(row => row.status === 'active'));
  const [occurrences, setOccurrences] = useState<CloudWorkoutOccurrenceRow[]>([]);
  const [cancelledRows, setCancelledRows] = useState<CloudWorkoutOccurrenceRow[]>([]);
  const [showCancelled, setShowCancelled] = useState(false);
  const basket = useRef<HTMLButtonElement>(null);
  const pendingCancel = useRef<string | null>(null);
  const cardSources = useRef(new Map<string, { element: HTMLDivElement; event: TimelineItem; state: Parameters<typeof DayScheduleEventCard>[0]['state'] }>());
  const animationDone = useRef<(() => void) | null>(null);
  const [collapse, setCollapse] = useState<{ source: LiquidCollapseBounds; event: TimelineItem; state: Parameters<typeof DayScheduleEventCard>[0]['state'] } | null>(null);
  const [drafts, setDrafts] = useState<LocalWorkoutOccurrenceDraft[]>([]);
  const [viewed, setViewed] = useState<LocalWorkoutOccurrenceDraft | null>(null);
  const [openedDraftId, setOpenedDraftId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [programUpdateError, setProgramUpdateError] = useState('');
  const [selectedProgramTitle, setSelectedProgramTitle] = useState<{ id: string; name: string | null } | null>(null);
  const activeRepository = useRef<WorkoutOccurrenceDraftRepository | null>(null);
  const editorGeneration = useRef(0);
  const [timingOverrides, setTimingOverrides] = useState<Record<string, { startsAtUtc: string; durationMinutes: number }>>({});
  const draftRepository = useMemo(() => cloud
    ? new WorkoutOccurrenceDraftRepository(cloud.db, cloud.actorUserId) : null,
    [cloud?.db, cloud?.actorUserId]);

  useEffect(() => {
    if (!draftRepository) return undefined;
    ++editorGeneration.current;
    activeRepository.current = draftRepository;
    setProgramUpdateError(''); setTimingOverrides({}); setCollapse(null);
    setLoading(true); setSessions([]); setSessionId(null); setOccurrences([]); setCancelledRows([]); setShowCancelled(false); setDrafts([]); setOpenedDraftId(null); setViewed(null);
    const subscription = draftRepository.observeWorkspace(({ occurrences, drafts, cancelled = [], sessions = [] }) => {
      setSessions(sessions); setCancelledRows(cancelled);
      setOccurrences(occurrences); setDrafts(drafts); setLoading(false); setError('');
      setTimingOverrides(current => Object.fromEntries(Object.entries(current).filter(([key, timing]) => {
        const row = key.startsWith('draft:') ? drafts.find(row => 'draft:' + row.id === key)
          : occurrences.find(row => 'occurrence:' + row.id === key);
        return row && (row.startsAtUtc !== timing.startsAtUtc || row.durationMinutes !== timing.durationMinutes);
      })));
    }, reason => {
      setLoading(false);
      setError(reason instanceof Error ? reason.message : 'Не удалось прочитать расписание');
    });
    return () => {
      activeRepository.current = null;
      pendingCancel.current = null; animationDone.current?.(); animationDone.current = null;
      subscription.unsubscribe();
    };
  }, [draftRepository]);

  useEffect(() => { ++editorGeneration.current; setClientUserIds([]); setShowCancelled(false); setFilterOpened(false); setOpenedDraftId(null); setViewed(null); setSessionId(null); setPersonalEventId(null); setCreation(null); setCreationNotice(''); }, [planning?.viewResetKey, cloud?.actorUserId]);

  useEffect(() => {
    if (!planning?.requestedDraftId) return;
    ++editorGeneration.current;
    setClientUserIds(role === 'coach' && planning.requestedClientUserId ? [planning.requestedClientUserId] : []);
    setCreation(null); setShowCancelled(false);
    setOpenedDraftId(planning.requestedDraftId);
    planning.clearDraft();
  }, [planning?.requestedDraftId]);

  const selectedPersonalEvent = occurrences.find(row => row.id === personalEventId && row.entryKind === 'personal_event') ?? null;
  useEffect(() => {
    if (!loading && personalEventId && !selectedPersonalEvent) setPersonalEventId(null);
  }, [loading, personalEventId, selectedPersonalEvent]);
  const selected = useMemo(() => {
    const draft = drafts.find(item => item.id === openedDraftId);
    if (draft) return draft;
    const row = occurrences.find(item => 'draft:' + item.id === openedDraftId);
    return row && cloud ? draftFromOccurrence(cloud.actorUserId, row) : viewed;
  }, [drafts, occurrences, openedDraftId, viewed, cloud?.actorUserId]);
  useEffect(() => {
    const id = selected?.trainingPlanId;
    setSelectedProgramTitle(null);
    if (!id || !planner) return;
    let active = true;
    const subscription = planner.programs.observeName(id,
      name => { if (active) setSelectedProgramTitle({ id, name }); },
      () => { if (active) setSelectedProgramTitle({ id, name: null }); });
    return () => { active = false; subscription.unsubscribe(); };
  }, [selected?.trainingPlanId, planner]);
  useEffect(() => {
    if (loading || !viewed) return;
    const id = viewed.targetOccurrenceId ?? viewed.id.slice(6);
    if (!occurrences.some(row => row.id === id) && !cancelledRows.some(row => row.id === id)
      && !drafts.some(row => row.id === viewed.id)) {
      ++editorGeneration.current; setViewed(null); setEditorNavigation(null);
    }
  }, [loading, viewed?.id, occurrences, cancelledRows, drafts]);
  const sourceProgramName = selectedProgramTitle && selectedProgramTitle.id === selected?.trainingPlanId
    ? selectedProgramTitle.name : null;
  const closeSession = useCallback(() => { setSessionId(null); setEditorNavigation(null); }, []);
  const closeEditor = useCallback(() => { ++editorGeneration.current; setOpenedDraftId(null); setViewed(null); setEditorNavigation(null); }, []);
  const closePersonalEvent = useCallback(() => { setPersonalEventId(null); setCreation(current => current === 'event' ? null : current); }, []);
  const createAction = useMemo(() => !selected && !sessionId && !personalEventId && !creation && !filterOpened ? {
    label: 'Создать', icon: 'plus' as const,
    popoverItems: [
      { id: 'workout', label: '+ Тренировка', icon: 'barbell' as const, onSelect: () => setCreation('workout') },
      { id: 'event', label: '+ Событие', icon: 'calendar-event' as const, onSelect: () => setCreation('event') },
    ],
  } : null, [selected?.id, sessionId, personalEventId, creation, filterOpened]);
  useNavigationSurfaceFloatingAction(createAction);
  const mayManage = (row: Pick<LocalWorkoutOccurrenceDraft, 'athleteUserId' | 'coachUserId' | 'format'>) => (row.athleteUserId === cloud?.actorUserId || row.coachUserId === cloud?.actorUserId)
    && (row.format !== 'coached' || row.coachUserId === cloud?.actorUserId);
  const mayEdit = (row: CloudWorkoutOccurrenceRow) => !row.cancelledAt && row.status === 'scheduled' && !row.workoutSessionId
    && (row.athleteUserId === cloud?.actorUserId || row.coachUserId === cloud?.actorUserId)
    && (row.format !== 'coached' || row.coachUserId === cloud?.actorUserId);
  useEffect(() => {
    if (selected) setDate(datePart(selected.startsAtUtc));
  }, [selected?.id, selected?.startsAtUtc]);

  useEffect(() => {
    if (plannedStart?.conflictActive) {
      onNavigationContextChange({ level: 2, title: 'Конфликт тренировок', contentMode: 'viewport', onBack: plannedStart.dismissConflict });
      return () => onNavigationContextChange(null);
    } else if (creation === 'workout') return;
    if (sessionId) {
      onNavigationContextChange(editorNavigation ?? { level: 2, title: 'Тренировка', contentMode: 'viewport', onBack: closeSession });
      return () => onNavigationContextChange(null);
    }
    if (creation === 'event' || personalEventId) {
      onNavigationContextChange({ level: 2, title: creation === 'event' ? 'Новое событие' : 'Личное событие',
        contentMode: 'viewport', onBack: closePersonalEvent });
    } else if (editorNavigation && selected) {
      onNavigationContextChange(editorNavigation);
    } else if (selected) {
      onNavigationContextChange({
        level: 2, title: 'Запланированная тренировка',
        scrollKey: 'schedule:draft:' + selected.id,
        identity: { title: 'Запланированная тренировка', icon: 'calendar-plus' },
        contentMode: 'viewport', onBack: closeEditor,
      });
    } else if (filterOpened) {
      onNavigationContextChange({
        level: 2, title: 'Выбрать клиентов', identity: { title: 'Выбрать клиентов', icon: 'users' },
        contentMode: 'viewport', onBack: () => setFilterOpened(false),
      });
    } else {
      const view = getDayScheduleValue(date);
      onNavigationContextChange({
        level: 1, title: showCancelled ? 'Отменённые тренировки' : view.title,
        identity: { title: view.title, icon: 'calendar-event' },
        calendar: { value: date, onChange: setDate },
        contentMode: 'viewport',
      });
    }
    return () => onNavigationContextChange(null);
  }, [date, showCancelled, plannedStart?.conflictActive, plannedStart?.dismissConflict, selected?.id, sessionId, closeSession, personalEventId, filterOpened, creation, editorNavigation, closePersonalEvent, onNavigationContextChange]);

  useEffect(() => {
    if (plannedStart?.conflictActive && plannedStart.conflictOccurrence) {
      setShowCancelled(false);
      setDate(datePart(plannedStart.conflictOccurrence.startsAtUtc));
    }
  }, [plannedStart?.conflictActive, plannedStart?.conflictOccurrence?.id]);

  const merged = useMemo(() => {
    const withTiming = <T extends LocalWorkoutOccurrenceDraft | CloudWorkoutOccurrenceRow>(row: T, type: string): T =>
      timingOverrides[type + ':' + row.id] ? { ...row, ...timingOverrides[type + ':' + row.id] } : row;
    const visible = (row: Pick<CloudWorkoutOccurrenceRow, 'id' | 'athleteUserId' | 'coachUserId' | 'format'>) => {
      const conflictId = plannedStart?.conflictActive ? plannedStart.conflictOccurrence?.id : null;
      if (conflictId && (row.id === conflictId || row.id === 'draft:' + conflictId)) return true;
      if (role === 'coach' && clientUserIds.length) return clientUserIds.includes(row.athleteUserId);
      return row.athleteUserId === cloud?.actorUserId
        || (row.coachUserId === cloud?.actorUserId && row.format === 'coached');
    };
    const executed = (row: LocalWorkoutOccurrenceDraft | CloudWorkoutOccurrenceRow, id: string) => sessions.some(session =>
      session.occurrenceId === id && session.realmId === row.realmId && session.athleteUserId === row.athleteUserId
      && session.coachUserId === row.coachUserId && session.clientUserId === row.clientUserId
      && (!row.workoutSessionId || row.workoutSessionId === session.id));
    if (showCancelled) return cancelledRows.filter(visible).flatMap(row => timelineEvents(row, 'occurrence'));
    return [
      ...occurrences.filter(row => !executed(row, row.id)).filter(visible).filter(row => !drafts.some(draft => draft.targetOccurrenceId === row.id))
        .flatMap(row => timelineEvents(withTiming(row, 'occurrence'), 'occurrence')),
      ...drafts.filter(row => !executed(row, row.targetOccurrenceId ?? row.id.slice(6))).filter(visible).flatMap(row => timelineEvents(withTiming(row, 'draft'), 'draft')),
      ...sessions.filter(visible).flatMap(row => sessionEvents(row, now)),
    ];
  }, [occurrences, drafts, sessions, now, cancelledRows, showCancelled, timingOverrides, role, clientUserIds, cloud?.actorUserId, plannedStart?.conflictActive, plannedStart?.conflictOccurrence?.id]);

  const eventsByDate = useMemo<Record<LocalDate, TimelineItem[]>>(() => {
    const grouped: Record<string, TimelineItem[]> = {};
    merged.forEach(event => {
      const key = event.date;
      (grouped[key] ??= []).push(event);
    });
    Object.values(grouped).forEach(rows =>
      rows.sort((a, b) => a.startMinutes - b.startMinutes || a.id.localeCompare(b.id)));
    return grouped as Record<LocalDate, TimelineItem[]>;
  }, [merged]);

  const save = async (selectedDraft: LocalWorkoutOccurrenceDraft, updateProgram: boolean) => {
    if (!cloud || !draftRepository) throw new Error('Сохранение недоступно');
    setProgramUpdateError('');
    const draft = await draftRepository.get(selectedDraft.id);
    if (!draft) throw new Error('Черновик не найден');
    const id = draft.autoCreatedProgram && !draft.previouslyPublished && planner
      ? await planner.publish(draft.id) : await draftRepository.save(draft.id);
    if (activeRepository.current !== draftRepository) return;
    setOpenedDraftId(current => current === selectedDraft.id ? 'draft:' + id : current);
    if (updateProgram && draft.trainingPlanId && draft.programDayId) {
      // Updating the source is a separate local operation; the workout is already saved.
      const repository = new ProgramManagementRepository(cloud.db, cloud.actorUserId);
      try {
        await repository.applyOccurrencePlan(draft.trainingPlanId, draft.programDayId, draft.plan, draft.originalPlan);
      } catch (reason) {
        if (activeRepository.current === draftRepository) {
          const detail = reason instanceof Error ? reason.message : 'Не удалось обновить день программы';
          setProgramUpdateError('Тренировка сохранена. Программа не обновлена: ' + detail);
        }
      }
    }
  };

  const openEvent = async (event: TimelineItem) => {
    ++editorGeneration.current;
    if (event.type === 'session') { closeEditor(); setSessionId(event.session.id); return; }
    if (event.type === 'draft') { setViewed(null); setOpenedDraftId(event.draft.id); return; }
    if (!cloud || !draftRepository) return;
    setViewed(null);
    const row = event.occurrence;
    if (row.cancelledAt || row.status === 'cancelled') { setOpenedDraftId(null); setViewed(draftFromOccurrence(cloud.actorUserId, row)); return; }
    if (row.entryKind === 'personal_event') { setPersonalEventId(row.id); return; }
    const draft = draftFromOccurrence(cloud.actorUserId, row);
    if (!mayEdit(row)) { setOpenedDraftId(null); setViewed(draft); return; }
    const existing = drafts.find(item => item.targetOccurrenceId === row.id);
    setOpenedDraftId(existing?.id ?? draft.id);
  };
  const changeEvent = async (id: string, date?: LocalDate, minutes?: number, duration?: number, cancel = false) => {
    if (!cloud || !draftRepository) return;
    const event = merged.find(item => item.id === id);
    if (!event || event.type === 'session') return;
    const current = event.type === 'draft' ? event.draft : event.occurrence;
    const start = date !== undefined && minutes !== undefined
      ? localScheduleInstant(date, `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}` as LocalTime)
      : current.startsAtUtc;
    if (event.type === 'occurrence' && !mayEdit(event.occurrence)) return;
    if (event.type === 'occurrence' && event.occurrence.entryKind === 'personal_event') {
      if (!personalEvents) return;
      if (cancel) { await personalEvents.cancel(current.id); return; }
      const key = 'occurrence:' + current.id;
      const timing = { startsAtUtc: start, durationMinutes: duration ?? current.durationMinutes };
      setTimingOverrides(previous => ({ ...previous, [key]: timing }));
      try { await personalEvents.move(current.id, timing); }
      catch (reason) {
        setTimingOverrides(previous => {
          if (previous[key] !== timing) return previous;
          const next = { ...previous }; delete next[key]; return next;
        });
        throw reason;
      }
      return;
    }
    if (cancel) {
      const target = event.type === 'occurrence' ? event.occurrence.id : event.draft.targetOccurrenceId;
      if (target) await draftRepository.cancel(target);
      else await draftRepository.delete(current.id);
      return;
    }
    const editorId = event.type === 'draft' ? event.draft.id : 'draft:' + event.occurrence.id;
    const key = event.type + ':' + current.id;
    const timing = { startsAtUtc: start, durationMinutes: duration ?? current.durationMinutes };
    setTimingOverrides(previous => ({ ...previous, [key]: timing }));
    try {
      await draftRepository.enqueueEdit(editorId, row => ({ ...row, startsAtUtc: start,
        durationMinutes: duration ?? row.durationMinutes }));
    } catch (reason) {
      if (activeRepository.current === draftRepository) setTimingOverrides(previous => {
        if (previous[key] !== timing) return previous;
        const next = { ...previous }; delete next[key]; return next;
      });
      throw reason;
    }
  };
  const animateCancellation = useCallback(async (id: string, commit: () => Promise<void>) => {
    const source = [...cardSources.current.values()].find(item => {
      if (item.event.type === 'session') return false;
      const row = item.event.type === 'draft' ? item.event.draft : item.event.occurrence;
      const occurrenceId = item.event.type === 'draft' ? item.event.draft.targetOccurrenceId ?? row.id.slice(6) : row.id;
      const bounds = item.element.getBoundingClientRect();
      return occurrenceId === id && bounds.bottom > 0 && bounds.top < window.innerHeight
        && bounds.right > 0 && bounds.left < window.innerWidth;
    });
    const rect = source?.element.getBoundingClientRect();
    const repository = activeRepository.current;
    await commit();
    if (activeRepository.current !== repository || !source || !rect?.width || !basket.current) return;
    await new Promise<void>(resolve => {
      animationDone.current?.(); animationDone.current = resolve;
      setCollapse({ source: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
        event: source.event, state: source.state });
    });
  }, []);
  useEffect(() => {
    const unregister = plannedStart?.registerCancellationPresentation?.(animateCancellation);
    return () => { unregister?.(); plannedStart?.dismissConflict?.(); };
  }, [plannedStart?.registerCancellationPresentation, plannedStart?.dismissConflict, animateCancellation]);
  const cancelAfterClose = () => {
    const id = pendingCancel.current;
    pendingCancel.current = null;
    if (id && draftRepository) report(plannedStart ? plannedStart.cancel(id)
      : animateCancellation(id, () => draftRepository.cancel(id)));
  };
  const report = (operation: Promise<void>) => { void operation.catch(reason => setError(reason instanceof Error ? reason.message : 'Не удалось изменить запись в расписании')); };

  return (
    <section className={`today-page${creation || selected || sessionId || personalEventId || filterOpened ? ' today-page--sheet-open' : ''}`} aria-label="Расписание" aria-busy={loading || undefined}>
      <DaySchedule date={date} eventsByDate={eventsByDate} onDateChange={setDate}
        className="today-page__schedule"
        eventsShareResource={(event, other) => bookingsShareParticipant(
          booking(event), booking(other))}
        isEventEditable={event => event.type !== 'session' && !showCancelled && (event.type === 'draft'
          ? !event.draft.workoutSessionId && (!event.draft.executionStatus || event.draft.executionStatus === 'scheduled')
            && event.durationMinutes === event.draft.durationMinutes
          : mayEdit(event.occurrence) && event.durationMinutes === event.occurrence.durationMinutes)}
        onEventMove={move => report(changeEvent(move.eventId, move.targetDate, move.startMinutes))}
        onEventResize={resize => report(changeEvent(resize.eventId, resize.date, resize.startMinutes, resize.durationMinutes))}
        onEventDelete={deletion => report(changeEvent(deletion.eventId, undefined, undefined, undefined, true))}
        renderEvent={(event, state) => <div style={{ height: '100%', visibility: collapse?.event.id === event.id ? 'hidden' : undefined }} ref={element => {
          if (element) cardSources.current.set(event.id, { element, event, state });
          else cardSources.current.delete(event.id);
        }}><BookingCard event={event} state={state} actor={actor}
          onClick={() => report(openEvent(event))} /></div>} />

      {role === 'coach' && (!selected || plannedStart?.conflictActive) && !sessionId && !personalEventId && !creation && !filterOpened ? <ScheduleFilterBar
        clients={clients} selected={clientUserIds} onOpen={() => setFilterOpened(true)}
        onRemove={id => setClientUserIds(current => current.filter(value => value !== id))} /> : null}
      {(!selected || plannedStart?.conflictActive) && !sessionId && !personalEventId && !creation && !filterOpened ? <div
        className={`today-page__basket${role === 'client' ? ' today-page__basket--first' : ''}`}>
        <ScheduleActionButton ref={basket} icon="trash" label="Отменённые тренировки" pressed={showCancelled}
          onClick={() => setShowCancelled(value => !value)} />
      </div> : null}
      {showCancelled && !selected && !sessionId && !personalEventId && !creation && !filterOpened ? <div className={`today-page__cancelled-label${role === 'client' ? ' today-page__cancelled-label--first' : ''}`}><Text variant="footnote">Отменённые тренировки</Text></div> : null}
      {collapse ? <LiquidCollapse source={collapse.source} targetRef={basket} onFinished={() => {
        setCollapse(null); animationDone.current?.(); animationDone.current = null;
      }}><BookingCard event={collapse.event} state={collapse.state} actor={actor} onClick={() => undefined} /></LiquidCollapse> : null}
      {role === 'coach' ? <ScheduleClientFilter opened={filterOpened} clients={clients}
        loading={cloud?.status === 'loading'} selected={clientUserIds}
        onClose={() => setFilterOpened(false)} onApply={ids => {
          setClientUserIds(ids.filter(id => clients.some(client => client.userId === id)));
          setFilterOpened(false);
        }} /> : null}

      {loading || error || (!selected && programUpdateError) || notice ? (
        <div className="today-page__status" aria-live="polite">
          <Text variant="footnote" tone="muted" role={error || (!selected && programUpdateError) ? 'alert' : undefined}>
            {(!selected && programUpdateError) || error || notice || 'Загружаем расписание…'}
          </Text>
        </div>
      ) : null}
      <ScheduleWorkoutCreator intent={creation === 'workout' ? creation : null} role={role} actor={actor} onClose={closeCreation}
        onNavigationContextChange={onNavigationContextChange} onCreated={(id, client, message) => {
          setCreation(null); setShowCancelled(false); setCreationNotice(message);
          setClientUserIds(role === 'coach' && client ? [client] : []);
          setViewed(null); setOpenedDraftId(id);
        }} />
      <PersonalEventSheet opened={creation === 'event' || Boolean(selectedPersonalEvent)}
        event={selectedPersonalEvent} date={date} repository={personalEvents} onClose={closePersonalEvent}
        onSaved={instant => {
          setCreation(null); setPersonalEventId(null); setClientUserIds([]); setDate(datePart(instant));
        }} />
      <CalendarSessionSheet sessionId={sessionId} role={role} actor={actor} initData={initData}
        onClose={closeSession} onNavigationContextChange={setEditorNavigation} />
      {draftRepository ? <OccurrenceDraftSheet suspended={plannedStart?.conflictActive} draft={selected} drafts={draftRepository} actor={actor} readOnly={viewed !== null}
        planLocked={Boolean(selected?.workoutSessionId || (selected?.executionStatus && selected.executionStatus !== 'scheduled'))}
        onStart={role === 'coach' && plannedStart && !viewed ? async draft => {
          const token = editorGeneration.current;
          const id = await plannedStart.start(draft);
          if (token === editorGeneration.current && activeRepository.current === draftRepository) {
            closeEditor(); plannedStart.showSession(id);
          }
        } : undefined}
        cancelled={Boolean(viewed && cancelledRows.some(row => row.id === (viewed.targetOccurrenceId ?? viewed.id.slice(6))))}
        onDelete={selected && mayManage(selected) && !selected.workoutSessionId
          && (!selected.executionStatus || selected.executionStatus === 'scheduled' || selected.executionStatus === 'cancelled') ? async draft => {
            const token = editorGeneration.current;
            await draftRepository.deactivate(draft.targetOccurrenceId ?? draft.id.slice(6));
            if (token === editorGeneration.current && activeRepository.current === draftRepository) closeEditor();
          } : undefined}
        onCancel={!viewed ? draft => {
          pendingCancel.current = draft.targetOccurrenceId ?? draft.id.slice(6); closeEditor();
        } : undefined}
        onClosed={cancelAfterClose}
        sourceProgramName={sourceProgramName} onClose={closeEditor} onSave={save} saveNotice={programUpdateError || creationNotice}
        onNavigationContextChange={setEditorNavigation} /> : null}
    </section>
  );
}
