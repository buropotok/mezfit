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
  Icon, type DayScheduleEvent, type LocalDate, type LocalTime } from '../ui';
import { useSchedulePlanning } from './SchedulePlanningContext';
import { usePlannedWorkoutStart } from '../workout/PlannedWorkoutStartContext';
import { OccurrenceDraftSheet } from './OccurrenceDraftSheet';
import { ScheduleFilterBar } from './ScheduleFilterBar';
import { ScheduleClientFilter } from './ScheduleClientFilter';
import { calendarSegments, localScheduleInstant } from './calendar-time';
import './today-page.css';

type TimelineItem = DayScheduleEvent & { date: string } & (
  | { type: 'draft'; draft: LocalWorkoutOccurrenceDraft }
  | { type: 'occurrence'; occurrence: CloudWorkoutOccurrenceRow }
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

function BookingCard({ event, state, actor, onClick }: {
  event: TimelineItem; state: Parameters<typeof DayScheduleEventCard>[0]['state'];
  actor?: ProgramActor; onClick: () => void;
}) {
  const row = event.type === 'draft' ? event.draft : event.occurrence;
  const person = useWorkoutPerson(row.athleteUserId, row.realmId, actor);
  const personalEvent = event.type === 'occurrence' && event.occurrence.entryKind === 'personal_event';
  return <DayScheduleEventCard title={personalEvent ? row.plan.name : person.name}
    detail={personalEvent ? row.plan.comment : row.plan.name} media={personalEvent ? undefined : person.avatar}
    variant={personalEvent ? 'event' : 'workout'}
    corner={<Icon name={personalEvent ? 'calendar-event' : row.format === 'coached' ? 'users' : 'user'} />}
    cornerSize={Math.min(32, (state.height ?? 62) / 2)}
    status={event.type === 'draft' ? <Badge color="yellow" textVariant="caption">Черновик</Badge> : undefined}
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
  const [occurrences, setOccurrences] = useState<CloudWorkoutOccurrenceRow[]>([]);
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
    setProgramUpdateError(''); setTimingOverrides({});
    setLoading(true); setOccurrences([]); setDrafts([]); setOpenedDraftId(null); setViewed(null);
    const subscription = draftRepository.observeWorkspace(({ occurrences, drafts }) => {
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
      subscription.unsubscribe();
    };
  }, [draftRepository]);

  useEffect(() => { ++editorGeneration.current; setClientUserIds([]); setFilterOpened(false); setOpenedDraftId(null); setViewed(null); setPersonalEventId(null); setCreation(null); setCreationNotice(''); }, [planning?.viewResetKey, cloud?.actorUserId]);

  useEffect(() => {
    if (!planning?.requestedDraftId) return;
    ++editorGeneration.current;
    setClientUserIds(role === 'coach' && planning.requestedClientUserId ? [planning.requestedClientUserId] : []);
    setCreation(null);
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
  const sourceProgramName = selectedProgramTitle && selectedProgramTitle.id === selected?.trainingPlanId
    ? selectedProgramTitle.name : null;
  const closeEditor = useCallback(() => { ++editorGeneration.current; setOpenedDraftId(null); setViewed(null); setEditorNavigation(null); }, []);
  const closePersonalEvent = useCallback(() => { setPersonalEventId(null); setCreation(current => current === 'event' ? null : current); }, []);
  const createAction = useMemo(() => !selected && !personalEventId && !creation && !filterOpened ? {
    label: 'Создать', icon: 'plus' as const,
    popoverItems: [
      { id: 'workout', label: '+ Тренировка', icon: 'barbell' as const, onSelect: () => setCreation('workout') },
      { id: 'event', label: '+ Событие', icon: 'calendar-event' as const, onSelect: () => setCreation('event') },
    ],
  } : null, [selected?.id, personalEventId, creation, filterOpened]);
  useNavigationSurfaceFloatingAction(createAction);
  const mayEdit = (row: CloudWorkoutOccurrenceRow) => row.status === 'scheduled' && !row.workoutSessionId
    && (row.athleteUserId === cloud?.actorUserId || row.coachUserId === cloud?.actorUserId)
    && (row.format !== 'coached' || row.coachUserId === cloud?.actorUserId);
  useEffect(() => {
    if (selected) setDate(datePart(selected.startsAtUtc));
  }, [selected?.id, selected?.startsAtUtc]);

  useEffect(() => {
    if (creation === 'workout') return;
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
        level: 1, title: view.title,
        identity: { title: view.title, icon: 'calendar-event' },
        calendar: { value: date, onChange: setDate },
        contentMode: 'viewport',
      });
    }
    return () => onNavigationContextChange(null);
  }, [date, selected?.id, personalEventId, filterOpened, creation, editorNavigation, closePersonalEvent, onNavigationContextChange]);

  const merged = useMemo(() => {
    const withTiming = <T extends LocalWorkoutOccurrenceDraft | CloudWorkoutOccurrenceRow>(row: T, type: string): T =>
      timingOverrides[type + ':' + row.id] ? { ...row, ...timingOverrides[type + ':' + row.id] } : row;
    const visible = (row: LocalWorkoutOccurrenceDraft | CloudWorkoutOccurrenceRow) => {
      if (role === 'coach' && clientUserIds.length) return clientUserIds.includes(row.athleteUserId);
      return row.athleteUserId === cloud?.actorUserId
        || (row.coachUserId === cloud?.actorUserId && row.format === 'coached');
    };
    return [
      ...occurrences.filter(visible).filter(row => !drafts.some(draft => draft.targetOccurrenceId === row.id))
        .flatMap(row => timelineEvents(withTiming(row, 'occurrence'), 'occurrence')),
      ...drafts.filter(visible).flatMap(row => timelineEvents(withTiming(row, 'draft'), 'draft')),
    ];
  }, [occurrences, drafts, timingOverrides, role, clientUserIds, cloud?.actorUserId]);

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
    if (event.type === 'draft') { setViewed(null); setOpenedDraftId(event.draft.id); return; }
    if (!cloud || !draftRepository) return;
    setViewed(null);
    const row = event.occurrence;
    if (row.entryKind === 'personal_event') { setPersonalEventId(row.id); return; }
    const draft = draftFromOccurrence(cloud.actorUserId, row);
    if (!mayEdit(row)) { setOpenedDraftId(null); setViewed(draft); return; }
    const existing = drafts.find(item => item.targetOccurrenceId === row.id);
    setOpenedDraftId(existing?.id ?? draft.id);
  };
  const changeEvent = async (id: string, date?: LocalDate, minutes?: number, duration?: number, cancel = false) => {
    if (!cloud || !draftRepository) return;
    const event = merged.find(item => item.id === id);
    if (!event) return;
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
  const report = (operation: Promise<void>) => { void operation.catch(reason => setError(reason instanceof Error ? reason.message : 'Не удалось изменить запись в расписании')); };

  return (
    <section className={`today-page${creation || selected || personalEventId || filterOpened ? ' today-page--sheet-open' : ''}`} aria-label="Расписание" aria-busy={loading || undefined}>
      <DaySchedule date={date} eventsByDate={eventsByDate} onDateChange={setDate}
        className="today-page__schedule"
        eventsShareResource={(event, other) => bookingsShareParticipant(
          event.type === 'draft' ? event.draft : event.occurrence,
          other.type === 'draft' ? other.draft : other.occurrence)}
        isEventEditable={event => (event.type === 'draft'
          ? event.durationMinutes === event.draft.durationMinutes
          : mayEdit(event.occurrence) && event.durationMinutes === event.occurrence.durationMinutes)}
        onEventMove={move => report(changeEvent(move.eventId, move.targetDate, move.startMinutes))}
        onEventResize={resize => report(changeEvent(resize.eventId, resize.date, resize.startMinutes, resize.durationMinutes))}
        onEventDelete={deletion => report(changeEvent(deletion.eventId, undefined, undefined, undefined, true))}
        renderEvent={(event, state) => <BookingCard event={event} state={state} actor={actor}
          onClick={() => report(openEvent(event))} />} />

      {role === 'coach' && !selected && !personalEventId && !creation && !filterOpened ? <ScheduleFilterBar
        clients={clients} selected={clientUserIds} onOpen={() => setFilterOpened(true)}
        onRemove={id => setClientUserIds(current => current.filter(value => value !== id))} /> : null}
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
          setCreation(null); setCreationNotice(message);
          setClientUserIds(role === 'coach' && client ? [client] : []);
          setViewed(null); setOpenedDraftId(id);
        }} />
      <PersonalEventSheet opened={creation === 'event' || Boolean(selectedPersonalEvent)}
        event={selectedPersonalEvent} date={date} repository={personalEvents} onClose={closePersonalEvent}
        onSaved={instant => {
          setCreation(null); setPersonalEventId(null); setClientUserIds([]); setDate(datePart(instant));
        }} />
      {draftRepository ? <OccurrenceDraftSheet draft={selected} drafts={draftRepository} actor={actor} readOnly={viewed !== null}
        planLocked={Boolean(selected?.workoutSessionId || (selected?.executionStatus && selected.executionStatus !== 'scheduled'))}
        onStart={role === 'coach' && plannedStart ? async draft => {
          const token = editorGeneration.current;
          const id = await plannedStart.start(draft);
          if (token === editorGeneration.current && activeRepository.current === draftRepository) {
            closeEditor(); plannedStart.showSession(id);
          }
        } : undefined}
        sourceProgramName={sourceProgramName} onClose={closeEditor} onSave={save} saveNotice={programUpdateError || creationNotice}
        onNavigationContextChange={setEditorNavigation} /> : null}
    </section>
  );
}
