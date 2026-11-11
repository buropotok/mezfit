import type { CloudWorkoutOccurrenceRow } from '../data/cloud/workout-foundation-types';
import type { CalendarWorkoutSession } from '../data/cloud/adhoc-workouts';
import type { LocalDate } from '../ui';

export type TimelineRow =
  | { kind: 'planned' | 'missed'; occurrence: CloudWorkoutOccurrenceRow; date: LocalDate }
  | { kind: 'completed'; session: CalendarWorkoutSession; date: LocalDate };

export type CalendarTimelineRow = TimelineRow
  | { kind: 'active'; session: CalendarWorkoutSession; date: LocalDate };

type Selection = {
  occurrences: readonly CloudWorkoutOccurrenceRow[];
  sessions: readonly CalendarWorkoutSession[];
  actorUserId: string | undefined;
  contact?: { userId: string; relationshipId: string };
  mode: 'plan' | 'history' | 'calendar';
  today: LocalDate;
  from?: LocalDate | null;
  to?: LocalDate | null;
};

export function localWorkoutDate(value: string | Date): LocalDate {
  const date = typeof value === 'string' ? new Date(value) : value;
  return [date.getFullYear(), date.getMonth() + 1, date.getDate()]
    .map((part, index) => String(part).padStart(index === 0 ? 4 : 2, '0')).join('-') as LocalDate;
}

/** Read-side projection only. It never authorizes or changes an occurrence or FACT. */
export function selectProfileWorkoutRows(options: Selection & { mode: 'plan' | 'history' }): TimelineRow[];
export function selectProfileWorkoutRows(options: Selection & { mode: 'calendar' }): CalendarTimelineRow[];
export function selectProfileWorkoutRows({
  occurrences, sessions, actorUserId, contact, mode, today, from, to,
}: Selection): CalendarTimelineRow[] {
  const belongs = (row: { athleteUserId: string; realmId: string }) =>
    contact ? row.athleteUserId === contact.userId && row.realmId === contact.relationshipId
      : row.athleteUserId === actorUserId;
  const planned: TimelineRow[] = [];
  const history: CalendarTimelineRow[] = [];
  const scopedSessions = sessions.filter(belongs);
  const linkedSessions = mode === 'calendar'
    ? new Map(scopedSessions.map(session => [session.occurrenceId, session]))
    : null;
  for (const occurrence of occurrences) {
    if (!belongs(occurrence) || occurrence.inactive || occurrence.cancelledAt
      || occurrence.status === 'cancelled' || occurrence.publicationStatus === 'draft') continue;
    const linked = linkedSessions?.get(occurrence.id);
    if (linked && linked.realmId === occurrence.realmId
      && linked.coachUserId === occurrence.coachUserId && linked.clientUserId === occurrence.clientUserId
      && (!occurrence.workoutSessionId || occurrence.workoutSessionId === linked.id)) continue;
    const date = localWorkoutDate(occurrence.startsAtUtc);
    if (occurrence.status === 'scheduled') {
      if (date < today) history.push({ kind: 'missed', occurrence, date });
      else planned.push({ kind: 'planned', occurrence, date });
    }
  }
  for (const session of scopedSessions) {
    if (session.status === 'completed' || mode === 'calendar') {
      history.push({ kind: session.status, session, date: localWorkoutDate(session.startedAt) });
    }
  }
  const inPeriod = (row: CalendarTimelineRow) => (!from || row.date >= from) && (!to || row.date <= to);
  const rows = mode === 'calendar' ? [...history, ...planned] : history;
  return (mode === 'plan' ? planned : rows.filter(inPeriod)).sort((a, b) => {
    const left = 'session' in a ? a.session.startedAt : a.occurrence.startsAtUtc;
    const right = 'session' in b ? b.session.startedAt : b.occurrence.startsAtUtc;
    return mode === 'plan' ? left.localeCompare(right) : right.localeCompare(left);
  });
}
