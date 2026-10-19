import { useEffect, useMemo, useRef, useState } from 'react';
import { ApiError, confirmCloudWorkoutOccurrence, type Role } from '../api';
import type { NavigationContext } from '../NavigationShell';
import { useCloudConnections } from '../data/cloud/CloudConnectionsProvider';
import { WorkoutOccurrenceDraftRepository } from '../data/cloud/workout-occurrence-drafts';
import { WorkoutSchedulingRepository } from '../data/cloud/workout-scheduling';
import { ProgramManagementRepository } from '../data/cloud/program-management';
import { draftFromOccurrence } from '../data/cloud/workout-occurrence-plan';
import { assertLocalWorkoutSlot, bookingsShareParticipant } from '../data/cloud/workout-slot-validation';
import type { ProgramActor } from '../program/ProgramSummary';
import { useWorkoutPerson } from './WorkoutPerson';
import type { LocalWorkoutOccurrenceDraft } from '../data/cloud/workout-occurrence-plan';
import type { CloudWorkoutOccurrenceRow } from '../data/cloud/workout-foundation-types';
import { Badge, DaySchedule, DayScheduleEventCard, Text, getDayScheduleValue,
  type DayScheduleEvent, type LocalDate, type LocalTime } from '../ui';
import { useSchedulePlanning } from './SchedulePlanningContext';
import { OccurrenceDraftSheet } from './OccurrenceDraftSheet';
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
    const base = { ...segment, id: `${type}:${row.id}:${segment.date}:${index}` };
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
  return <DayScheduleEventCard title={person.name} detail={row.plan.name} media={person.avatar}
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
  const planning = useSchedulePlanning();
  const [date, setDate] = useState<LocalDate>(currentDate);
  const [occurrences, setOccurrences] = useState<CloudWorkoutOccurrenceRow[]>([]);
  const [confirmed, setConfirmed] = useState<CloudWorkoutOccurrenceRow[]>([]);
  const observedIds = useRef(new Set<string>());
  const [drafts, setDrafts] = useState<LocalWorkoutOccurrenceDraft[]>([]);
  const [viewed, setViewed] = useState<LocalWorkoutOccurrenceDraft | null>(null);
  const [openedDraftId, setOpenedDraftId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const changingEvent = useRef(false);
  const scheduling = useMemo(() => cloud
    ? new WorkoutSchedulingRepository(cloud.db, cloud.actorUserId) : null,
    [cloud?.db, cloud?.actorUserId]);
  const draftRepository = useMemo(() => cloud
    ? new WorkoutOccurrenceDraftRepository(cloud.db, cloud.actorUserId) : null,
    [cloud?.actorUserId]);

  useEffect(() => {
    if (!scheduling || !draftRepository) return undefined;
    const seen = new Set<string>();
    observedIds.current = seen;
    setLoading(true); setOccurrences([]); setDrafts([]); setConfirmed([]);
    const sub = scheduling.observeCalendar(rows => {
      for (const row of rows) seen.add(row.id);
      setConfirmed(current => current.filter(row => row.lastMutationId
        ? row.status === 'cancelled' ? rows.some(remote => remote.id === row.id) || !seen.has(row.id)
          : rows.some(remote => remote.id === row.id)
            ? !rows.some(remote => remote.id === row.id && remote.lastMutationId === row.lastMutationId)
            : !seen.has(row.id)
        : !seen.has(row.id)));
      setOccurrences(rows); setLoading(false); setError('');
    }, reason => {
      setLoading(false);
      setError(reason instanceof Error ? reason.message : 'Не удалось прочитать расписание');
    });
    const local = draftRepository.observe(rows => setDrafts(rows), reason => {
      setError(reason instanceof Error ? reason.message : 'Не удалось загрузить черновики');
    });
    return () => {
      observedIds.current = new Set();
      sub.unsubscribe(); local.unsubscribe();
    };
  }, [scheduling, draftRepository]);

  useEffect(() => {
    if (!planning?.requestedDraftId) return;
    setOpenedDraftId(planning.requestedDraftId);
    planning.clearDraft();
  }, [planning?.requestedDraftId]);

  const selected = drafts.find(draft => draft.id === openedDraftId) ?? viewed;
  const closeEditor = () => { setOpenedDraftId(null); setViewed(null); };
  const mayEdit = (row: CloudWorkoutOccurrenceRow) => row.status === 'scheduled' && !row.workoutSessionId
    && (row.athleteUserId === cloud?.actorUserId || row.coachUserId === cloud?.actorUserId)
    && (row.format !== 'coached' || row.coachUserId === cloud?.actorUserId);
  useEffect(() => {
    if (selected) setDate(datePart(selected.startsAtUtc));
  }, [selected?.id, selected?.startsAtUtc]);

  useEffect(() => {
    if (selected) {
      onNavigationContextChange({
        level: 2, title: 'Запланировать тренировку',
        scrollKey: 'schedule:draft:' + selected.id,
        identity: { title: 'Запланировать тренировку', icon: 'calendar-plus' },
        contentMode: 'viewport', onBack: closeEditor,
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
  }, [date, selected?.id, onNavigationContextChange]);

  const merged = useMemo(() => {
    const acknowledged = confirmed;
    return [
      ...occurrences.filter(row => !confirmed.some(ack => ack.id === row.id)
        && !drafts.some(draft => draft.targetOccurrenceId === row.id)).flatMap(row => timelineEvents(row, 'occurrence')),
      ...acknowledged.filter(row => row.status !== 'cancelled' && !drafts.some(draft => draft.targetOccurrenceId === row.id))
        .flatMap(row => timelineEvents(row, 'occurrence')),
      ...drafts.flatMap(row => timelineEvents(row, 'draft')),
    ];
  }, [occurrences, confirmed, drafts]);

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
    const seen = observedIds.current;
    await assertLocalWorkoutSlot(cloud.db, selectedDraft, confirmed);
    const prepared = await draftRepository.prepareSubmission(selectedDraft.id);
    const draft = prepared.draft;
    let id: string;
    try { id = await confirmCloudWorkoutOccurrence(initData, draft); }
    catch (reason) {
      // Only the first, definitively rejected request can unlock the editor.
      // A later refusal cannot disprove creation by an earlier ambiguous attempt.
      if (prepared.isNewSubmission && reason instanceof ApiError
        && [400, 401, 403, 413].includes(reason.status))
        await draftRepository.releaseSubmission(draft.id);
      throw reason;
    }
    if (seen !== observedIds.current) throw new Error('Аккаунт изменился. Откройте расписание заново');
    // This record is displayed only after the privileged server confirmed persistence.
    // Dexie Cloud Addon remains the durable read authority and will replace it on sync.
    setConfirmed(rows => !draft.targetOccurrenceId && seen.has(id) ? rows : [...rows.filter(row => row.id !== id), {
      id, realmId: draft.realmId, owner: null, trainingPlanId: draft.trainingPlanId,
      coachUserId: draft.coachUserId, clientUserId: draft.clientUserId,
      athleteUserId: draft.athleteUserId, programDayId: draft.programDayId,
      workoutSessionId: null, format: draft.format, startsAtUtc: draft.startsAtUtc,
      durationMinutes: draft.durationMinutes, status: draft.cancelRequested ? 'cancelled' : 'scheduled',
      ...(draft.targetOccurrenceId ? { lastMutationId: 'req:' + draft.actorUserId + ':' + draft.id.slice(6) } : {}),
      plan: draft.plan, createdByUserId: draft.actorUserId,
    }]);
    if (updateProgram) {
      // The booking is already confirmed. A separate authorized PLAN operation
      // can fail independently and must be reported without duplicating the booking.
      const repository = new ProgramManagementRepository(cloud.db, cloud.actorUserId);
      await repository.applyOccurrencePlan(draft.trainingPlanId, draft.programDayId, draft.plan, draft.originalPlan);
    }
    await draftRepository.delete(draft.id, true);
    closeEditor();
  };

  const openEvent = async (event: TimelineItem) => {
    if (event.type === 'draft') { setViewed(null); setOpenedDraftId(event.draft.id); return; }
    if (!cloud || !draftRepository) return;
    setViewed(null);
    const row = event.occurrence;
    const draft = draftFromOccurrence(cloud.actorUserId, row);
    if (!mayEdit(row)) { setOpenedDraftId(null); setViewed(draft); return; }
    const existing = drafts.find(item => item.targetOccurrenceId === row.id);
    if (existing) { setOpenedDraftId(existing.id); return; }
    await draftRepository.create(draft);
    setOpenedDraftId(draft.id);
  };
  const changeEvent = async (id: string, date?: LocalDate, minutes?: number, duration?: number, cancel = false) => {
    if (!cloud || !draftRepository || changingEvent.current) return;
    changingEvent.current = true;
    try {
      const event = merged.find(item => item.id === id);
      if (!event) return;
      const current = event.type === 'draft' ? event.draft : event.occurrence;
      const start = date !== undefined && minutes !== undefined
        ? localScheduleInstant(date, `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}` as LocalTime)
        : current.startsAtUtc;
      if (event.type === 'draft') {
        if (cancel) {
          await draftRepository.delete(current.id);
          if (event.draft.targetOccurrenceId) {
            const cancellation = { ...event.draft, id: 'draft:' + crypto.randomUUID(),
              cancelRequested: true, submissionPending: false };
            await draftRepository.create(cancellation);
            await save(cancellation, false);
          }
          return;
        }
        const candidate = { ...event.draft, startsAtUtc: start, durationMinutes: duration ?? current.durationMinutes };
        await assertLocalWorkoutSlot(cloud.db, candidate, confirmed);
        await draftRepository.enqueueEdit(current.id, row => ({ ...row, startsAtUtc: start, durationMinutes: candidate.durationMinutes }));
        return;
      }
      if (!mayEdit(event.occurrence)) return;
      const draft = { ...draftFromOccurrence(cloud.actorUserId, event.occurrence),
        startsAtUtc: start, durationMinutes: duration ?? current.durationMinutes, cancelRequested: cancel };
      await assertLocalWorkoutSlot(cloud.db, draft, confirmed);
      await draftRepository.create(draft);
      await save(draft, false);
    } finally { changingEvent.current = false; }
  };
  const report = (operation: Promise<void>) => { void operation.catch(reason => setError(reason instanceof Error ? reason.message : 'Не удалось изменить тренировку')); };

  return (
    <section className="today-page" aria-label="Расписание" aria-busy={loading || undefined}>
      <DaySchedule date={date} eventsByDate={eventsByDate} onDateChange={setDate}
        className="today-page__schedule"
        eventsShareResource={(event, other) => bookingsShareParticipant(
          event.type === 'draft' ? event.draft : event.occurrence,
          other.type === 'draft' ? other.draft : other.occurrence)}
        isEventEditable={event => !changingEvent.current && (event.type === 'draft'
          ? !event.draft.submissionPending && event.durationMinutes === event.draft.durationMinutes
          : mayEdit(event.occurrence) && event.durationMinutes === event.occurrence.durationMinutes)}
        onEventMove={move => report(changeEvent(move.eventId, move.targetDate, move.startMinutes))}
        onEventResize={resize => report(changeEvent(resize.eventId, resize.date, resize.startMinutes, resize.durationMinutes))}
        onEventDelete={deletion => report(changeEvent(deletion.eventId, undefined, undefined, undefined, true))}
        renderEvent={(event, state) => <BookingCard event={event} state={state} actor={actor}
          onClick={() => report(openEvent(event))} />} />

      {loading || error || notice ? (
        <div className="today-page__status" aria-live="polite">
          <Text variant="footnote" tone="muted">
            {error || notice || 'Загружаем расписание…'}
          </Text>
        </div>
      ) : null}
      {draftRepository ? <OccurrenceDraftSheet key={selected?.id ?? 'closed'} draft={selected} drafts={draftRepository} actor={actor} readOnly={viewed !== null}
        onClose={closeEditor} onSave={save} /> : null}
    </section>
  );
}
