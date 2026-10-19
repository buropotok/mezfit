import { useEffect, useMemo, useRef, useState } from 'react';
import { ApiError, confirmCloudWorkoutOccurrence, type Role } from '../api';
import type { NavigationContext } from '../NavigationShell';
import { useCloudConnections } from '../data/cloud/CloudConnectionsProvider';
import { WorkoutOccurrenceDraftRepository } from '../data/cloud/workout-occurrence-drafts';
import { WorkoutSchedulingRepository } from '../data/cloud/workout-scheduling';
import { ProgramManagementRepository } from '../data/cloud/program-management';
import type { LocalWorkoutOccurrenceDraft } from '../data/cloud/workout-occurrence-plan';
import type { CloudWorkoutOccurrenceRow } from '../data/cloud/workout-foundation-types';
import { Avatar, DaySchedule, DayScheduleEventCard, Text, getDayScheduleValue,
  type DayScheduleEvent, type LocalDate } from '../ui';
import { useSchedulePlanning } from './SchedulePlanningContext';
import { OccurrenceDraftSheet } from './OccurrenceDraftSheet';
import { calendarSegments } from './calendar-time';
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

export function TodayPage({
  initData, role, onNavigationContextChange, notice = '',
}: {
  initData: string;
  role: Role;
  currentUserId?: number;
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
  const [openedDraftId, setOpenedDraftId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
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
      setConfirmed(current => current.filter(row => !seen.has(row.id)));
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

  const selected = drafts.find(draft => draft.id === openedDraftId) ?? null;
  useEffect(() => {
    if (selected) setDate(datePart(selected.startsAtUtc));
  }, [selected?.id, selected?.startsAtUtc]);

  useEffect(() => {
    if (selected) {
      onNavigationContextChange({
        level: 2, title: 'Запланировать тренировку',
        scrollKey: 'schedule:draft:' + selected.id,
        identity: { title: 'Запланировать тренировку', icon: 'calendar-plus' },
        contentMode: 'viewport', onBack: () => setOpenedDraftId(null),
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
    const acknowledged = confirmed.filter(row => !occurrences.some(current => current.id === row.id));
    return [
      ...occurrences.flatMap(row => timelineEvents(row, 'occurrence')),
      ...acknowledged.flatMap(row => timelineEvents(row, 'occurrence')),
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
    setConfirmed(rows => seen.has(id) ? rows : [...rows.filter(row => row.id !== id), {
      id, realmId: draft.realmId, owner: null, trainingPlanId: draft.trainingPlanId,
      coachUserId: draft.coachUserId, clientUserId: draft.clientUserId,
      athleteUserId: draft.athleteUserId, programDayId: draft.programDayId,
      workoutSessionId: null, format: draft.format, startsAtUtc: draft.startsAtUtc,
      durationMinutes: draft.durationMinutes, status: 'scheduled',
      plan: draft.plan, createdByUserId: draft.actorUserId,
    }]);
    if (updateProgram) {
      // The booking is already confirmed. A separate authorized PLAN operation
      // can fail independently and must be reported without duplicating the booking.
      const repository = new ProgramManagementRepository(cloud.db, cloud.actorUserId);
      await repository.applyOccurrencePlan(draft.trainingPlanId, draft.programDayId, draft.plan, draft.originalPlan);
    }
    await draftRepository.delete(draft.id, true);
    setOpenedDraftId(null);
  };

  return (
    <section className="today-page" aria-label="Расписание" aria-busy={loading || undefined}>
      <DaySchedule date={date} eventsByDate={eventsByDate} onDateChange={setDate}
        className="today-page__schedule"
        renderEvent={(event, state) => {
          const isDraft = event.type === 'draft';
          const plan = isDraft ? event.draft.plan : event.occurrence.plan;
          const actor = cloud?.actorUserId;
          const athlete = isDraft ? event.draft.athleteUserId : event.occurrence.athleteUserId;
          const person = cloud?.clients.find(c => c.userId === athlete)
            ?? cloud?.coaches.find(c => c.userId === athlete);
          const title = role === 'coach' && athlete !== actor ? person?.displayName ?? 'Клиент' : plan.name;
          const detail = isDraft ? 'Черновик · ' + plan.name
            : (event.occurrence.format === 'coached' ? 'В зале с клиентом' : 'Самостоятельная')
              + ' · ' + plan.name;
          return <DayScheduleEventCard title={title} detail={detail} state={state}
            media={<Avatar name={title} />}
            onClick={isDraft ? () => setOpenedDraftId(event.draft.id) : undefined} />;
        }} />
      {loading || error || notice ? (
        <div className="today-page__status" aria-live="polite">
          <Text variant="footnote" tone="muted">
            {error || notice || 'Загружаем расписание…'}
          </Text>
        </div>
      ) : null}
      {draftRepository ? <OccurrenceDraftSheet key={selected?.id ?? 'closed'} draft={selected} drafts={draftRepository}
        onClose={() => setOpenedDraftId(null)} onSave={save} /> : null}
    </section>
  );
}
