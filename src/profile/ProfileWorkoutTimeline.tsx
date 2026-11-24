import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button as KonstaButton } from 'konsta/react';
import { useNavigationCalendar, type NavigationContext } from '../NavigationShell';
import type { CloudContact } from '../data/cloud/CloudConnectionsProvider';
import { useCloudConnections } from '../data/cloud/CloudConnectionsProvider';
import type { CloudWorkoutOccurrenceRow } from '../data/cloud/workout-foundation-types';
import { localWorkoutDate as localDate, selectProfileWorkoutRows, type CalendarTimelineRow, type ProfileWorkoutRow } from './profile-workout-selection';
import type { CalendarWorkoutSession } from '../data/cloud/adhoc-workouts';
import { WorkoutOccurrenceDraftRepository } from '../data/cloud/workout-occurrence-drafts';
import { draftFromOccurrence } from '../data/cloud/workout-occurrence-plan';
import { occurrencePlanEditRestriction } from '../data/cloud/planned-session-policy';
import { WorkoutPlanningRepository } from '../data/cloud/workout-planning';
import type { ProgramActor } from '../program/ProgramSummary';
import { useWorkoutPerson } from '../schedule/WorkoutPerson';
import { OccurrenceDraftSheet } from '../schedule/OccurrenceDraftSheet';
import { CalendarSessionSheet } from '../schedule/CalendarSessionSheet';
import { preferredWorkoutDayStatus } from '../schedule/workout-day-statuses';
import { WorkoutPlanCardHeader } from '../workout/WorkoutPlanCard';
import { WorkoutPlanStatusBadge } from '../workout/WorkoutPlanStatusBadge';
import { Avatar, Badge, DatePicker, GlassSurface, Icon, Text, type DatePickerDayStatus, type LocalDate } from '../ui';
import { useProfileSnapshot } from './ProfileDataProvider';
import './profile-workout-timeline.css';

const EMPTY_OCCURRENCES: CloudWorkoutOccurrenceRow[] = [];
const EMPTY_SESSIONS: CalendarWorkoutSession[] = [];

function dateLabel(date: LocalDate): string {
  return date.split('-').reverse().join('.');
}

function timeLabel(instant: string | null | undefined): string {
  if (!instant) return '…';
  const date = new Date(instant);
  return Number.isNaN(date.getTime()) ? '…' : date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

function PlanRow({ row, showPlannedStatus, actor, onOpen }: {
  row: Extract<ProfileWorkoutRow, { kind: 'planned' | 'missed' | 'draft' }>;
  showPlannedStatus: boolean; actor?: ProgramActor; onOpen: () => void;
}) {
  const { kind } = row;
  const workout = row.kind === 'draft' ? row.draft : row.occurrence;
  const creatorId = row.kind === 'draft' ? undefined : row.occurrence.createdByUserId;
  const athlete = useWorkoutPerson(workout.athleteUserId, workout.realmId, actor);
  const creator = useWorkoutPerson(creatorId ?? workout.coachUserId ?? workout.athleteUserId, workout.realmId, actor);
  const end = new Date(Date.parse(workout.startsAtUtc) + workout.durationMinutes * 60_000);
  const label = kind === 'draft' ? 'Черновик тренировки' : kind === 'missed' ? 'Пропущенная тренировка' : 'Запланированная тренировка';
  return <GlassSurface component="button" wrapContent={false} optics={false}
    className="profile-workout-card" onClick={onOpen} aria-label={`${label}: ${workout.plan.name}`}>
    <WorkoutPlanCardHeader name={workout.plan.name}
      programName={workout.trainingPlanId ? 'Программа тренировок' : 'Без программы'}
      creatorName={creator.name} creatorAvatar={creator.passiveAvatar}
      athleteName={athlete.name} athleteAvatar={athlete.passiveAvatar}
      status={kind !== 'planned' || showPlannedStatus ? <WorkoutPlanStatusBadge status={kind} /> : undefined}
      scheduledTiming={{ date: dateLabel(row.date),
        time: `${timeLabel(workout.startsAtUtc)} — ${timeLabel(end.toISOString())}` }}>
      <span className="workout-plan-card__chevron"><Icon name="chevron-right" /></span>
    </WorkoutPlanCardHeader>
  </GlassSurface>;
}

/** FACT keeps its own compact markup; PLAN and FACT business components are not combined. */
function SessionRow({ session, programName, actor, onOpen }: {
  session: CalendarWorkoutSession; programName: string; actor?: ProgramActor; onOpen: () => void;
}) {
  const athlete = useWorkoutPerson(session.athleteUserId, session.realmId, actor);
  const completed = session.status === 'completed';
  return <GlassSurface component="button" wrapContent={false} optics={false}
    className="profile-workout-card" onClick={onOpen} aria-label={`${completed ? 'Завершённая тренировка' : 'Тренировка в процессе'}: ${session.name}`}>
    <div className="workout-session-card__header workout-session-card__header--scheduled">
      <span className="workout-session-card__icon">
        <Icon name="barbell" className="workout-session-card__icon-artwork" />
      </span>
      <div className="workout-session-card__copy">
        <Text variant="body" className="workout-session-card__workout-name">{session.name}</Text>
        <Text variant="footnote" tone="muted" className="workout-session-card__program-name">
          {programName}
        </Text>
      </div>
      <div className="workout-session-card__time">
        <Text variant="footnote">{dateLabel(localDate(session.startedAt))}</Text>
        <Text variant="footnote" tone="muted">{timeLabel(session.startedAt)} — {timeLabel(session.completedAt)}</Text>
      </div>
      <span className="workout-plan-card__chevron"><Icon name="chevron-right" /></span>
      <div className="workout-plan-card__avatar" aria-label={`Атлет: ${athlete.name}`}>
        {athlete.passiveAvatar ?? <Avatar name={athlete.name} />}
      </div>
      <div className="workout-session-card__status-row">
        <Badge color="gray" textVariant="caption">{completed ? 'Завершена' : 'В процессе'}</Badge>
      </div>
    </div>
  </GlassSurface>;
}

/** A read-only profile projection over the existing local-first schedule, not a second workout store. */
export function ProfileWorkoutTimeline({ mode, role, contact, actor, initData, onNavigationContextChange, onCalendarChange }: {
  mode: 'plan' | 'history';
  role: 'coach' | 'client';
  contact?: CloudContact;
  actor?: ProgramActor;
  initData: string;
  onNavigationContextChange: (context: NavigationContext | null) => void;
  onCalendarChange?: (calendar: NavigationContext['calendar']) => void;
}) {
  const cloud = useCloudConnections();
  const repository = useMemo(() => cloud?.db && /^tg:[1-9]\d*$/.test(cloud.actorUserId)
    ? new WorkoutOccurrenceDraftRepository(cloud.db, cloud.actorUserId) : null,
  [cloud?.db, cloud?.actorUserId]);
  const planner = useMemo(() => cloud?.db && /^tg:[1-9]\d*$/.test(cloud.actorUserId)
    ? new WorkoutPlanningRepository(cloud.db, cloud.actorUserId) : null,
  [cloud?.db, cloud?.actorUserId]);
  const { workouts, historyFilter, setHistoryFilter } = useProfileSnapshot();
  const occurrences = workouts.data?.occurrences ?? EMPTY_OCCURRENCES;
  const sessions = workouts.data?.sessions ?? EMPTY_SESSIONS;
  const loading = !workouts.data && !workouts.failed;
  const [now, setNow] = useState(Date.now);
  const today = localDate(new Date(now));
  const { from, to } = historyFilter;
  const navigationCalendar = useNavigationCalendar();
  const [pendingCalendarDay, setPendingCalendarDay] = useState<LocalDate | null>(null);
  const [picker, setPicker] = useState<'from' | 'to' | null>(null);
  const [openedOccurrenceId, setOpenedOccurrenceId] = useState<string | null>(null);
  const [openedSessionId, setOpenedSessionId] = useState<string | null>(null);
  const [sessionRole, setSessionRole] = useState(role);
  const [nestedNavigation, setNestedNavigation] = useState<NavigationContext | null>(null);
  const [sourceProgramName, setSourceProgramName] = useState<string | null>(null);

  useEffect(() => {
    const tick = () => setNow(Date.now());
    const timer = window.setInterval(tick, 60_000);
    document.addEventListener('visibilitychange', tick);
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', tick); };
  }, []);
  const selected = occurrences.find(row => row.id === openedOccurrenceId) ?? null;
  const selectedDraft = useMemo(() => workouts.data?.drafts?.find(row => row.id === 'draft:' + openedOccurrenceId)
    ?? (selected && cloud ? draftFromOccurrence(cloud.actorUserId, selected) : null),
  [workouts.data?.drafts, openedOccurrenceId, selected, cloud?.actorUserId]);
  const editRestriction = selectedDraft ? occurrencePlanEditRestriction(selectedDraft) : null;
  useEffect(() => {
    if (!workouts.data || !openedOccurrenceId || selectedDraft) return;
    setOpenedOccurrenceId(null);
  }, [workouts.data, openedOccurrenceId, selectedDraft]);
  useEffect(() => {
    setSourceProgramName(null);
    if (!planner || !selectedDraft?.trainingPlanId) return;
    let active = true;
    const subscription = planner.programs.observeName(selectedDraft.trainingPlanId,
      name => { if (active) setSourceProgramName(name); },
      () => { if (active) setSourceProgramName(null); });
    return () => { active = false; subscription.unsubscribe(); };
  }, [planner, selectedDraft?.trainingPlanId]);

  const drafts = workouts.data?.drafts;
  const rows = useMemo(() => selectProfileWorkoutRows({ occurrences, drafts, sessions,
    actorUserId: cloud?.actorUserId, contact, mode, today, now, from, to,
  }), [occurrences, drafts, sessions, cloud?.actorUserId, contact?.userId, contact?.relationshipId, mode, today, now, from, to]);

  const calendarEnabled = Boolean(onCalendarChange);
  const clientUserId = contact?.userId;
  const relationshipId = contact?.relationshipId;
  const { rowsByDate, dayStatuses } = useMemo(() => {
    const rowsByDate = new Map<LocalDate, CalendarTimelineRow[]>();
    const statuses = new Map<LocalDate, DatePickerDayStatus>();
    if (calendarEnabled) {
      const calendarRows = selectProfileWorkoutRows({ occurrences, sessions, actorUserId: cloud?.actorUserId,
        contact: clientUserId && relationshipId ? { userId: clientUserId, relationshipId } : undefined,
        mode: 'calendar', today, now });
      for (const row of calendarRows) {
        const group = rowsByDate.get(row.date);
        if (group) group.push(row);
        else rowsByDate.set(row.date, [row]);
        const status = row.kind === 'completed' || row.kind === 'missed' ? row.kind : 'scheduled';
        statuses.set(row.date, preferredWorkoutDayStatus(statuses.get(row.date), status));
      }
    }
    return { rowsByDate, dayStatuses: Array.from(statuses, ([date, status]) => ({ date, status })) };
  }, [calendarEnabled, occurrences, sessions, cloud?.actorUserId, clientUserId, relationshipId, today, now]);

  const openWorkout = useCallback((row: ProfileWorkoutRow) => {
    setNestedNavigation(null);
    if ('session' in row) {
      // In their own profile, a coach can also be the athlete in another coach's realm.
      setSessionRole(!contact && row.session.clientUserId === cloud?.actorUserId ? 'client' : role);
    }
    setOpenedSessionId('session' in row ? row.session.id : null);
    setOpenedOccurrenceId(row.kind === 'draft' ? row.occurrenceId
      : 'occurrence' in row ? row.occurrence.id : null);
  }, [contact, cloud?.actorUserId, role]);
  const close = useCallback(() => { setOpenedOccurrenceId(null); setOpenedSessionId(null); setNestedNavigation(null); }, []);
  const selectCalendarDay = useCallback((date: LocalDate) => {
    close();
    setHistoryFilter({ from: date, to: date });
    const group = rowsByDate.get(date);
    if (workouts.data) {
      if (group?.length === 1) openWorkout(group[0]);
    } else {
      setPendingCalendarDay(date);
    }
  }, [close, setHistoryFilter, rowsByDate, workouts.data, openWorkout]);

  useEffect(() => {
    onCalendarChange?.({ value: to, onChange: selectCalendarDay, dayStatuses });
    return () => onCalendarChange?.(undefined);
  }, [onCalendarChange, to, selectCalendarDay, dayStatuses]);

  useEffect(() => {
    if (!pendingCalendarDay || !workouts.data) return;
    setPendingCalendarDay(null);
    const group = rowsByDate.get(pendingCalendarDay);
    if (pendingCalendarDay === from && pendingCalendarDay === to && group?.length === 1) openWorkout(group[0]);
  }, [pendingCalendarDay, from, to, workouts.data, rowsByDate, openWorkout]);

  useEffect(() => {
    if (picker) {
      onNavigationContextChange({ level: 2, title: 'Период тренировок', onBack: () => setPicker(null) });
    } else if (openedSessionId || openedOccurrenceId) {
      onNavigationContextChange(nestedNavigation ?? { level: 2,
        title: openedSessionId ? 'Тренировка' : 'Запланированная тренировка',
        contentMode: 'viewport', onBack: close });
    } else {
      onNavigationContextChange(null);
    }
    return () => onNavigationContextChange(null);
  }, [picker, openedOccurrenceId, openedSessionId, nestedNavigation, close, onNavigationContextChange]);

  return <section className="profile-workout-timeline" aria-label={mode === 'plan' ? 'План тренировок' : 'Тренировки'}>
    {mode === 'history' ? <div className="profile-workout-timeline__filters">
      <KonstaButton rounded tonal inline onClick={() => setPicker('from')}><Text variant="footnote">{from ? `С ${dateLabel(from)}` : 'С даты'}</Text></KonstaButton>
      <Text variant="footnote" tone="muted">—</Text>
      <KonstaButton rounded tonal inline onClick={() => setPicker('to')}><Text variant="footnote">По {dateLabel(to)}</Text></KonstaButton>
      <KonstaButton rounded tonal inline disabled={!navigationCalendar} onClick={() => navigationCalendar?.toggle()}>
        <Text variant="footnote">Календарь</Text>
      </KonstaButton>
      <KonstaButton rounded clear inline onClick={() => {
        setPendingCalendarDay(null);
        setHistoryFilter({ from: null, to: today });
      }}><Text variant="footnote">Сбросить</Text></KonstaButton>
    </div> : null}
    {from && from > to && mode === 'history' ? <Text variant="footnote" role="alert">Дата начала позже даты окончания</Text> : null}
    {loading ? <Text variant="body">Загружаем тренировки…</Text> : null}
    {workouts.failed ? <div className="stack"><Text variant="footnote" role="alert">
      Не удалось {workouts.data ? 'обновить' : 'загрузить'} тренировки.
    </Text><KonstaButton rounded tonal onClick={workouts.retry}>
      <Text variant="body">Повторить</Text>
    </KonstaButton></div> : null}
    {workouts.data && rows.length === 0 ? <Text variant="body" tone="muted">
      {mode === 'plan' ? 'Запланированных тренировок нет'
        : from && from === to ? 'В этот день тренировок нет' : 'Тренировок за выбранный период нет'}
    </Text> : null}
    <div className="profile-workout-list">
      {rows.map(row => 'session' in row
        ? <SessionRow key={`session:${row.session.id}`} session={row.session}
          programName={row.session.programName ?? 'Без программы'} actor={actor}
          onOpen={() => openWorkout(row)} />
        : <PlanRow key={`occurrence:${row.kind === 'draft' ? row.occurrenceId : row.occurrence.id}`}
          row={row} showPlannedStatus={mode === 'plan'} actor={actor}
          onOpen={() => openWorkout(row)} />)}
    </div>
    <DatePicker opened={picker !== null} surface="panel"
      value={(picker === 'to' ? to : from) ?? today}
      onClose={() => setPicker(null)} onChange={value => {
        setPendingCalendarDay(null);
        if (picker) setHistoryFilter(({ from, to }) => ({ from, to, [picker]: value }));
        setPicker(null);
      }} />
    <CalendarSessionSheet sessionId={openedSessionId} role={sessionRole} initData={initData} actor={actor}
      onClose={close} onNavigationContextChange={setNestedNavigation} />
    {repository ? <OccurrenceDraftSheet draft={selectedDraft} drafts={repository}
      actor={actor} readOnly={editRestriction !== null}
      planLocked={Boolean(selectedDraft?.workoutSessionId || (selectedDraft?.executionStatus && selectedDraft.executionStatus !== 'scheduled'))}
      onClose={close} onSave={async draft => { await repository.save(draft.id); }}
      sourceProgramName={sourceProgramName} onNavigationContextChange={setNestedNavigation} /> : null}
  </section>;
}
