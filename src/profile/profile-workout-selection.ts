import type { CloudWorkoutOccurrenceRow } from '../data/cloud/workout-foundation-types';
import type { LocalWorkoutOccurrenceDraft } from '../data/cloud/workout-occurrence-plan';
import type { CalendarWorkoutSession } from '../data/cloud/adhoc-workouts';
import type { LocalDate } from '../ui';
import { isScheduledWorkoutMissed } from '../schedule/workout-day-statuses';

export type TimelineRow =
  | { kind: 'planned' | 'missed'; occurrence: CloudWorkoutOccurrenceRow; date: LocalDate }
  | { kind: 'completed'; session: CalendarWorkoutSession; date: LocalDate };

type DraftTimelineRow = { kind: 'draft'; draft: LocalWorkoutOccurrenceDraft; occurrenceId: string; date: LocalDate };

export type CalendarTimelineRow = TimelineRow
  | { kind: 'active'; session: CalendarWorkoutSession; date: LocalDate };

export type ProfileWorkoutRow = CalendarTimelineRow | DraftTimelineRow;

type Selection = {
  drafts?: readonly LocalWorkoutOccurrenceDraft[];
  occurrences: readonly CloudWorkoutOccurrenceRow[];
  sessions: readonly CalendarWorkoutSession[];
  actorUserId: string | undefined;
  contact?: { userId: string; relationshipId: string };
  mode: 'plan' | 'history' | 'calendar';
  today: LocalDate;
  now?: number;
  from?: LocalDate | null;
  to?: LocalDate | null;
};

export function localWorkoutDate(value: string | Date): LocalDate {
  const date = typeof value === 'string' ? new Date(value) : value;
  return [date.getFullYear(), date.getMonth() + 1, date.getDate()]
    .map((part, index) => String(part).padStart(index === 0 ? 4 : 2, '0')).join('-') as LocalDate;
}

/** Read-side projection only. It never authorizes or changes an occurrence or FACT. */
export function selectProfileWorkoutRows(options: Selection & { mode: 'plan'; drafts?: undefined }): TimelineRow[];
export function selectProfileWorkoutRows(options: Selection & { mode: 'history' | 'calendar' }): CalendarTimelineRow[];
export function selectProfileWorkoutRows(options: Selection): ProfileWorkoutRow[];
export function selectProfileWorkoutRows({
  occurrences, drafts = [], sessions, actorUserId, contact, mode, today, now, from, to,
}: Selection): ProfileWorkoutRow[] {
  const currentTime = now ?? Date.parse(`${today}T00:00:00`);
  const belongs = (row: { athleteUserId: string; realmId: string }) =>
    contact ? row.athleteUserId === contact.userId && row.realmId === contact.relationshipId
      : row.athleteUserId === actorUserId;
  const planned: TimelineRow[] = [];
  const history: CalendarTimelineRow[] = [];
  const scopedSessions = sessions.filter(belongs);
  const linkedSessions = new Map(scopedSessions.map(session => [session.occurrenceId, session]));
  const hasLinkedSession = (id: string, row: Pick<LocalWorkoutOccurrenceDraft,
    'realmId' | 'coachUserId' | 'clientUserId' | 'workoutSessionId'>) => {
    const linked = linkedSessions.get(id);
    return linked && linked.realmId === row.realmId
      && linked.coachUserId === row.coachUserId && linked.clientUserId === row.clientUserId
      && (!row.workoutSessionId || row.workoutSessionId === linked.id);
  };
  for (const occurrence of occurrences) {
    if (!belongs(occurrence) || occurrence.inactive || occurrence.cancelledAt
      || occurrence.status === 'cancelled' || occurrence.publicationStatus === 'draft'
      || hasLinkedSession(occurrence.id, occurrence)) continue;
    const date = localWorkoutDate(occurrence.startsAtUtc);
    if (occurrence.status === 'scheduled') {
      if (isScheduledWorkoutMissed(occurrence, currentTime)) history.push({ kind: 'missed', occurrence, date });
      else planned.push({ kind: 'planned', occurrence, date });
    }
  }
  for (const session of scopedSessions) {
    if (session.status === 'completed' || mode !== 'plan') {
      history.push({ kind: session.status, session, date: localWorkoutDate(session.startedAt) });
    }
  }
  const startsAt = (row: ProfileWorkoutRow) => 'session' in row ? row.session.startedAt
    : row.kind === 'draft' ? row.draft.startsAtUtc : row.occurrence.startsAtUtc;
  if (mode === 'plan') {
    const rows: ProfileWorkoutRow[] = [...planned];
    for (const draft of drafts) {
      if (!draft.targetOccurrenceId || !belongs(draft) || draft.saved || draft.workoutSessionId
        || (draft.executionStatus && draft.executionStatus !== 'scheduled')
        || hasLinkedSession(draft.targetOccurrenceId, draft)
        || isScheduledWorkoutMissed(draft, currentTime)) continue;
      rows.push({ kind: 'draft', draft, occurrenceId: draft.targetOccurrenceId, date: localWorkoutDate(draft.startsAtUtc) });
    }
    return rows.sort((a, b) => startsAt(a).localeCompare(startsAt(b)));
  }
  return [...history, ...planned].filter(row => (!from || row.date >= from) && (!to || row.date <= to))
    .sort((a, b) => startsAt(b).localeCompare(startsAt(a)));
}
