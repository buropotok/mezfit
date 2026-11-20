import type { SourceImportPackageV1, SourceRef, SourceScheduledWorkout, SourceSession } from '../worker/processor/source-package/types';
import { businessDate, exactStart } from './timing';
import type { ImportConfig, IssueCode } from './contracts';
import { compare } from './schema';

export const byKey = <T extends { sourceKey: string }>(rows: T[]) => new Map(rows.map(row => [row.sourceKey, row]));
export const linked = (ref: SourceRef) => ref.state === 'linked' ? ref.sourceKey : null;
export const ordered = <T extends { position: number }>(rows: T[]) => [...rows].sort((a, b) => a.position - b.position);
export type Workout = SourceScheduledWorkout | SourceSession;
export const isSession = (row: Workout): row is SourceSession => 'completionState' in row;

export function sourceGraph(pkg: SourceImportPackageV1, period: ImportConfig['period']) {
  const appointments = byKey(pkg.scheduledWorkouts);
  const programs = byKey(pkg.programs);
  const subjects = byKey(pkg.subjects);
  const dayOwners = new Map(pkg.programs.flatMap(row => row.days.map(day => [day.sourceKey, row.sourceKey] as const)));
  const represented = new Set(pkg.sessions.map(row => linked(row.scheduledWorkoutRef)));
  const uncertainSubjects = new Set(pkg.sessions.filter(row => row.scheduledWorkoutRef.state === 'unknown'
    || row.scheduledWorkoutRef.state === 'linked' && !appointments.has(row.scheduledWorkoutRef.sourceKey))
    .map(row => linked(row.subjectRef)));

  function inspect(row: Workout) {
    const problems: IssueCode[] = [];
    const occurrenceKey = isSession(row) ? linked(row.scheduledWorkoutRef) : null;
    const appointment = isSession(row) ? (occurrenceKey ? appointments.get(occurrenceKey) : undefined) : row;
    if (isSession(row) && (row.scheduledWorkoutRef.state === 'unknown' || occurrenceKey && !appointment)) {
      problems.push('UNRESOLVED_SOURCE_LINK');
    }
    const dayRef: SourceRef = appointment?.programDayRef ?? { state: 'none' };
    const day = linked(dayRef);
    const dayOwner = day ? dayOwners.get(day) : undefined;
    const profile = linked(row.subjectRef);
    const appointmentProfile = appointment ? linked(appointment.subjectRef) : null;
    const subjectKey = profile ?? appointmentProfile;
    if (!subjectKey || !subjects.has(subjectKey) || row.subjectRef.state !== 'linked') problems.push('UNRESOLVED_SUBJECT');
    if (appointment && appointment !== row && (!appointmentProfile || appointmentProfile !== profile)) {
      problems.push('UNRESOLVED_SUBJECT');
    }

    const direct = linked(row.programRef);
    const indirect = appointment ? linked(appointment.programRef) : null;
    const candidates = new Set([direct, indirect, dayOwner].filter(key => key != null));
    const programKey = candidates.values().next().value ?? null;
    if (candidates.size > 1 || programKey && (row.programRef.state === 'none'
      || appointment?.programRef.state === 'none')) problems.push('CONFLICTING_PROGRAM_LINK');
    if (day && !dayOwner || dayRef.state === 'unknown') problems.push('UNRESOLVED_SOURCE_LINK');
    const program = programKey ? programs.get(programKey) : undefined;
    if (programKey && !program || !programKey && (row.programRef.state === 'unknown'
      || appointment?.programRef.state === 'unknown')) problems.push('UNRESOLVED_PROGRAM');
    if (program && linked(program.subjectRef) !== subjectKey) problems.push('UNRESOLVED_SUBJECT');

    const date = businessDate(row.timing);
    const outside = date.date !== null && (date.date < period.fromDate || date.date > period.throughDate);
    const suppressed = !isSession(row) && represented.has(row.sourceKey);
    if (date.issue) problems.push(date.issue);
    if (!isSession(row) && !suppressed && (pkg.coverage.sessions !== 'complete'
      || uncertainSubjects.has(null) || uncertainSubjects.has(subjectKey))) problems.push('SESSION_LINK_UNCERTAIN');
    if (isSession(row) && row.completionState !== 'completed') problems.push('SESSION_NOT_COMPLETED');
    const noProgram = row.programRef.state === 'none' && (!appointment || appointment.programRef.state === 'none')
      && dayRef.state === 'none' && (!isSession(row) || row.scheduledWorkoutRef.state === 'none' || !!appointment);
    return { row, date: date.date, suppressed, outside, problems, subjectKey, programKey, dayRef, noProgram };
  }

  const workouts = [...pkg.sessions, ...pkg.scheduledWorkouts].map(inspect).sort((a, b) =>
    compare(a.date ?? '', b.date ?? '')
    || compare(subjects.get(a.subjectKey ?? '')?.displayName ?? '', subjects.get(b.subjectKey ?? '')?.displayName ?? '')
    || compare(a.row.sourceKey, b.row.sourceKey)
    || Number(isSession(b.row)) - Number(isSession(a.row)));
  return { workouts, programs };
}

type Candidate = ReturnType<typeof sourceGraph>['workouts'][number];
export function lastCompleted(candidates: Candidate[]): SourceSession | null {
  const completed = candidates.filter((item): item is Candidate & { row: SourceSession } =>
    isSession(item.row) && item.row.completionState === 'completed');
  const newest = completed.at(-1);
  if (!newest?.date || completed.some(item => item.date === null)) return null;
  const sameDay = completed.filter(item => item.date === newest.date);
  if (sameDay.length === 1) return newest.row;
  const times = sameDay.map(item => ({ row: item.row, stamp: exactStart(item.row.timing) }));
  if (times.some(item => item.stamp === null)) return null;
  times.sort((a, b) => (b.stamp ?? 0) - (a.stamp ?? 0));
  return times[0].stamp === times[1].stamp ? null : times[0].row;
}
