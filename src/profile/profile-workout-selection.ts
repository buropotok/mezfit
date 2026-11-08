import type { CloudWorkoutOccurrenceRow } from '../data/cloud/workout-foundation-types';
import type { CalendarWorkoutSession } from '../data/cloud/adhoc-workouts';
import type { LocalDate } from '../ui';

export type TimelineRow =
  | { kind: 'planned' | 'missed'; occurrence: CloudWorkoutOccurrenceRow; date: LocalDate }
  | { kind: 'completed'; session: CalendarWorkoutSession; date: LocalDate };

export function localWorkoutDate(value: string | Date): LocalDate {
  const date = typeof value === 'string' ? new Date(value) : value;
  return [date.getFullYear(), date.getMonth() + 1, date.getDate()]
    .map((part, index) => String(part).padStart(index === 0 ? 4 : 2, '0')).join('-') as LocalDate;
}

/** Read-side projection only. It never authorizes or changes an occurrence or FACT. */
export function selectProfileWorkoutRows({
  occurrences, sessions, actorUserId, contact, mode, today, from, to,
}: {
  occurrences: readonly CloudWorkoutOccurrenceRow[];
  sessions: readonly CalendarWorkoutSession[];
  actorUserId: string | undefined;
  contact?: { userId: string; relationshipId: string };
  mode: 'plan' | 'history';
  today: LocalDate;
  from?: LocalDate | null;
  to?: LocalDate | null;
}): TimelineRow[] {
  const belongs = (row: { athleteUserId: string; realmId: string }) =>
    contact ? row.athleteUserId === contact.userId && row.realmId === contact.relationshipId
      : row.athleteUserId === actorUserId;
  const planned: TimelineRow[] = [];
  const history: TimelineRow[] = [];
  for (const occurrence of occurrences) {
    if (!belongs(occurrence) || occurrence.inactive || occurrence.cancelledAt
      || occurrence.status === 'cancelled' || occurrence.publicationStatus === 'draft') continue;
    const date = localWorkoutDate(occurrence.startsAtUtc);
    if (occurrence.status === 'scheduled') {
      if (date < today) history.push({ kind: 'missed', occurrence, date });
      else planned.push({ kind: 'planned', occurrence, date });
    }
  }
  for (const session of sessions) {
    if (belongs(session) && session.status === 'completed') {
      history.push({ kind: 'completed', session, date: localWorkoutDate(session.startedAt) });
    }
  }
  const inPeriod = (row: TimelineRow) => (!from || row.date >= from) && (!to || row.date <= to);
  return (mode === 'plan' ? planned : history.filter(inPeriod)).sort((a, b) => {
    const left = a.kind === 'completed' ? a.session.startedAt : a.occurrence.startsAtUtc;
    const right = b.kind === 'completed' ? b.session.startedAt : b.occurrence.startsAtUtc;
    return mode === 'plan' ? left.localeCompare(right) : right.localeCompare(left);
  });
}
