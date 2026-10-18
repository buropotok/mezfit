import { useEffect, useMemo, useState } from 'react';
import { confirmCloudWorkoutOccurrence, type Role } from '../api';
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
import './today-page.css';

type TimelineItem = DayScheduleEvent & (
  | { type: 'draft'; draft: LocalWorkoutOccurrenceDraft }
  | { type: 'occurrence'; occurrence: CloudWorkoutOccurrenceRow }
);

function datePart(instant: string): LocalDate {
  const date = new Date(instant);
  const parts = [date.getFullYear(), date.getMonth() + 1, date.getDate()];
  return parts.map((value, i) => String(value).padStart(i === 0 ? 4 : 2, '0')).join('-') as LocalDate;
}
function currentDate(): LocalDate { return datePart(new Date().toISOString()); }

function timelineEvent(
  row: LocalWorkoutOccurrenceDraft | CloudWorkoutOccurrenceRow, type: 'draft' | 'occurrence',
): TimelineItem {
  const start = new Date(row.startsAtUtc);
  const startMinutes = start.getHours() * 60 + start.getMinutes();
  const base = { id: type === 'draft' ? 'draft:' + row.id : row.id,
    startMinutes, durationMinutes: Math.min(row.durationMinutes, 1440 - startMinutes) };
  return type === 'draft' ? { ...base, type, draft: row as LocalWorkoutOccurrenceDraft }
    : { ...base, type, occurrence: row as CloudWorkoutOccurrenceRow };
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
    setLoading(true); setOccurrences([]); setDrafts([]);
    const sub = scheduling.observeCalendar(rows => {
      setOccurrences(rows); setLoading(false); setError('');
    }, reason => {
      setLoading(false);
      setError(reason instanceof Error ? reason.message : 'Не удалось прочитать расписание');
    });
    const local = draftRepository.observe(rows => setDrafts(rows), reason => {
      setError(reason instanceof Error ? reason.message : 'Не удалось загрузить черновики');
    });
    return () => { sub.unsubscribe(); local.unsubscribe(); };
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
      ...occurrences.map(row => timelineEvent(row, 'occurrence')),
      ...acknowledged.map(row => timelineEvent(row, 'occurrence')),
      ...drafts.map(row => timelineEvent(row, 'draft')),
    ];
  }, [occurrences, confirmed, drafts]);

  const eventsByDate = useMemo<Record<LocalDate, TimelineItem[]>>(() => {
    const grouped: Record<string, TimelineItem[]> = {};
    merged.forEach(event => {
      const key = datePart(event.type === 'draft'
        ? event.draft.startsAtUtc : event.occurrence.startsAtUtc);
      (grouped[key] ??= []).push(event);
    });
    Object.values(grouped).forEach(rows =>
      rows.sort((a, b) => a.startMinutes - b.startMinutes || a.id.localeCompare(b.id)));
    return grouped as Record<LocalDate, TimelineItem[]>;
  }, [merged]);

  const save = async (draft: LocalWorkoutOccurrenceDraft, updateProgram: boolean) => {
    if (!cloud || !draftRepository) throw new Error('Сохранение недоступно');
    const id = await confirmCloudWorkoutOccurrence(initData, draft);
    // This record is displayed only after the privileged server confirmed persistence.
    // Dexie Cloud Addon remains the durable read authority and will replace it on sync.
    setConfirmed(rows => [...rows.filter(row => row.id !== id), {
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
    await draftRepository.delete(draft.id);
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
      {draftRepository ? <OccurrenceDraftSheet draft={selected} drafts={draftRepository}
        onClose={() => setOpenedDraftId(null)} onSave={save} /> : null}
    </section>
  );
}
