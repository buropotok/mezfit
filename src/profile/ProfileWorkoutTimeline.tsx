import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button as KonstaButton } from 'konsta/react';
import type { NavigationContext } from '../NavigationShell';
import type { CloudContact } from '../data/cloud/CloudConnectionsProvider';
import { useCloudConnections } from '../data/cloud/CloudConnectionsProvider';
import type { CloudWorkoutOccurrenceRow } from '../data/cloud/workout-foundation-types';
import { localWorkoutDate as localDate, selectProfileWorkoutRows } from './profile-workout-selection';
import type { CalendarWorkoutSession } from '../data/cloud/adhoc-workouts';
import { WorkoutOccurrenceDraftRepository } from '../data/cloud/workout-occurrence-drafts';
import { draftFromOccurrence } from '../data/cloud/workout-occurrence-plan';
import { WorkoutPlanningRepository } from '../data/cloud/workout-planning';
import type { ProgramActor } from '../program/ProgramSummary';
import { useWorkoutPerson } from '../schedule/WorkoutPerson';
import { OccurrenceDraftSheet } from '../schedule/OccurrenceDraftSheet';
import { CalendarSessionSheet } from '../schedule/CalendarSessionSheet';
import { WorkoutPlanCardHeader } from '../workout/WorkoutPlanCard';
import { Avatar, Badge, DatePicker, GlassSurface, Icon, Text, type LocalDate } from '../ui';
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

function PlanRow({ occurrence, missed, actor, onOpen }: {
  occurrence: CloudWorkoutOccurrenceRow; missed: boolean; actor?: ProgramActor; onOpen: () => void;
}) {
  const athlete = useWorkoutPerson(occurrence.athleteUserId, occurrence.realmId, actor);
  const creator = useWorkoutPerson(occurrence.createdByUserId ?? occurrence.coachUserId ?? occurrence.athleteUserId,
    occurrence.realmId, actor);
  const end = new Date(Date.parse(occurrence.startsAtUtc) + occurrence.durationMinutes * 60_000);
  return <GlassSurface component="button" wrapContent={false} shape="capsule" optics={false}
    className="profile-workout-card" onClick={onOpen} aria-label={`${missed ? 'Пропущенная' : 'Запланированная'} тренировка: ${occurrence.plan.name}`}>
    <WorkoutPlanCardHeader name={occurrence.plan.name}
      programName={occurrence.trainingPlanId ? 'Программа тренировок' : 'Без программы'}
      creatorName={creator.name} creatorAvatar={creator.passiveAvatar}
      athleteName={athlete.name} athleteAvatar={athlete.passiveAvatar}
      status={missed ? <Badge color="gray" textVariant="caption">Пропущена</Badge> : undefined}
      scheduledTiming={{ date: dateLabel(localDate(occurrence.startsAtUtc)),
        time: `${timeLabel(occurrence.startsAtUtc)} — ${timeLabel(end.toISOString())}` }}>
      <span className="workout-plan-card__chevron"><Icon name="chevron-right" /></span>
    </WorkoutPlanCardHeader>
  </GlassSurface>;
}

/** FACT keeps its own compact markup; PLAN and FACT business components are not combined. */
function SessionRow({ session, programName, actor, onOpen }: {
  session: CalendarWorkoutSession; programName: string; actor?: ProgramActor; onOpen: () => void;
}) {
  const athlete = useWorkoutPerson(session.athleteUserId, session.realmId, actor);
  return <GlassSurface component="button" wrapContent={false} shape="capsule" optics={false}
    className="profile-workout-card" onClick={onOpen} aria-label={`Завершённая тренировка: ${session.name}`}>
    <div className="workout-session-card__header workout-session-card__header--scheduled">
      <span className="workout-session-card__icon">
        <Icon name="barbell" className="workout-session-card__icon-artwork" />
      </span>
      <div className="workout-session-card__copy">
        <Text variant="body" className="workout-session-card__workout-name">{session.name}</Text>
        <Text variant="footnote" tone="muted" className="workout-session-card__program-name">
          {programName}
        </Text>
        <Badge color="gray" textVariant="caption">Завершена</Badge>
      </div>
      <div className="workout-session-card__time">
        <Text variant="footnote">{dateLabel(localDate(session.startedAt))}</Text>
        <Text variant="footnote" tone="muted">{timeLabel(session.startedAt)} — {timeLabel(session.completedAt)}</Text>
      </div>
      <span className="workout-plan-card__chevron"><Icon name="chevron-right" /></span>
      <div className="workout-plan-card__avatar" aria-label={`Атлет: ${athlete.name}`}>
        {athlete.passiveAvatar ?? <Avatar name={athlete.name} />}
      </div>
    </div>
  </GlassSurface>;
}

/** A read-only profile projection over the existing local-first schedule, not a second workout store. */
export function ProfileWorkoutTimeline({ mode, role, contact, actor, initData, onNavigationContextChange }: {
  mode: 'plan' | 'history';
  role: 'coach' | 'client';
  contact?: CloudContact;
  actor?: ProgramActor;
  initData: string;
  onNavigationContextChange: (context: NavigationContext | null) => void;
}) {
  const cloud = useCloudConnections();
  const repository = useMemo(() => cloud
    ? new WorkoutOccurrenceDraftRepository(cloud.db, cloud.actorUserId) : null,
  [cloud?.db, cloud?.actorUserId]);
  const planner = useMemo(() => cloud
    ? new WorkoutPlanningRepository(cloud.db, cloud.actorUserId) : null,
  [cloud?.db, cloud?.actorUserId]);
  const { workouts, historyFilter, setHistoryFilter } = useProfileSnapshot();
  const occurrences = workouts.data?.occurrences ?? EMPTY_OCCURRENCES;
  const sessions = workouts.data?.sessions ?? EMPTY_SESSIONS;
  const loading = !workouts.data && !workouts.failed;
  const [today, setToday] = useState<LocalDate>(() => localDate(new Date()));
  const { from, to } = historyFilter;
  const [picker, setPicker] = useState<'from' | 'to' | null>(null);
  const [openedOccurrenceId, setOpenedOccurrenceId] = useState<string | null>(null);
  const [openedSessionId, setOpenedSessionId] = useState<string | null>(null);
  const [nestedNavigation, setNestedNavigation] = useState<NavigationContext | null>(null);
  const [sourceProgramName, setSourceProgramName] = useState<string | null>(null);

  useEffect(() => {
    const tick = () => setToday(localDate(new Date()));
    const timer = window.setInterval(tick, 60_000);
    document.addEventListener('visibilitychange', tick);
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', tick); };
  }, []);

  const selected = occurrences.find(row => row.id === openedOccurrenceId) ?? null;
  const selectedDraft = useMemo(() => selected && cloud
    ? draftFromOccurrence(cloud.actorUserId, selected) : null, [selected, cloud?.actorUserId]);
  useEffect(() => {
    if (!workouts.data || !openedOccurrenceId || selected) return;
    setOpenedOccurrenceId(null);
  }, [workouts.data, openedOccurrenceId, selected]);
  useEffect(() => {
    setSourceProgramName(null);
    if (!planner || !selected?.trainingPlanId) return;
    let active = true;
    const subscription = planner.programs.observeName(selected.trainingPlanId,
      name => { if (active) setSourceProgramName(name); },
      () => { if (active) setSourceProgramName(null); });
    return () => { active = false; subscription.unsubscribe(); };
  }, [planner, selected?.trainingPlanId]);

  const rows = useMemo(() => selectProfileWorkoutRows({ occurrences, sessions,
    actorUserId: cloud?.actorUserId, contact, mode, today, from, to,
  }), [occurrences, sessions, cloud?.actorUserId, contact?.userId, contact?.relationshipId, mode, today, from, to]);

  const close = useCallback(() => { setOpenedOccurrenceId(null); setOpenedSessionId(null); setNestedNavigation(null); }, []);
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

  return <section className="profile-workout-timeline" aria-label={mode === 'plan' ? 'План тренировок' : 'История тренировок'}>
    {mode === 'history' ? <div className="profile-workout-timeline__filters">
      <KonstaButton rounded tonal inline onClick={() => setPicker('from')}><Text variant="footnote">{from ? `С ${dateLabel(from)}` : 'С даты'}</Text></KonstaButton>
      <KonstaButton rounded tonal inline onClick={() => setPicker('to')}><Text variant="footnote">{to ? `По ${dateLabel(to)}` : 'По дату'}</Text></KonstaButton>
      {from || to ? <KonstaButton rounded clear inline onClick={() => { setHistoryFilter({ from: null, to: null }); }}><Text variant="footnote">Сбросить</Text></KonstaButton> : null}
    </div> : null}
    {from && to && from > to && mode === 'history' ? <Text variant="footnote" role="alert">Дата начала позже даты окончания</Text> : null}
    {loading ? <Text variant="body">Загружаем тренировки…</Text> : null}
    {workouts.failed ? <div className="stack"><Text variant="footnote" role="alert">
      Не удалось {workouts.data ? 'обновить' : 'загрузить'} тренировки.
    </Text><KonstaButton rounded tonal onClick={workouts.retry}>
      <Text variant="body">Повторить</Text>
    </KonstaButton></div> : null}
    {workouts.data && rows.length === 0 ? <Text variant="body" tone="muted">
      {mode === 'plan' ? 'Запланированных тренировок нет' : 'Тренировок за выбранный период нет'}
    </Text> : null}
    <div className="profile-workout-list">
      {rows.map(row => row.kind === 'completed'
        ? <SessionRow key={`session:${row.session.id}`} session={row.session}
          programName={row.session.programName ?? 'Без программы'} actor={actor}
          onOpen={() => { setNestedNavigation(null); setOpenedSessionId(row.session.id); }} />
        : <PlanRow key={`occurrence:${row.occurrence.id}`} occurrence={row.occurrence}
          missed={row.kind === 'missed'} actor={actor}
          onOpen={() => { setNestedNavigation(null); setOpenedOccurrenceId(row.occurrence.id); }} />)}
    </div>
    <DatePicker opened={picker !== null} surface="panel"
      value={(picker === 'to' ? to : from) ?? today}
      onClose={() => setPicker(null)} onChange={value => {
        if (picker) setHistoryFilter(previous => ({ ...previous, [picker]: value }));
        setPicker(null);
      }} />
    <CalendarSessionSheet sessionId={openedSessionId} role={role} initData={initData} actor={actor}
      onClose={close} onNavigationContextChange={setNestedNavigation} />
    {repository ? <OccurrenceDraftSheet draft={selectedDraft} drafts={repository}
      actor={actor} readOnly onClose={close} onSave={async () => { throw new Error('Редактирование доступно в календаре'); }}
      sourceProgramName={sourceProgramName} onNavigationContextChange={setNestedNavigation} /> : null}
  </section>;
}
