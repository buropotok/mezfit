import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, List, ListItem } from 'konsta/react';
import type { CloudTrainingPlanRow } from '../data/cloud/database';
import type { AdHocWorkoutRepository } from '../data/cloud/adhoc-workouts';
import type { ProgramDetails } from '../data/cloud/program-management';
import { planAuthorUserId } from '../data/cloud/program-ownership';
import { useCloudConnections } from '../data/cloud/CloudConnectionsProvider';
import { CloudContactAvatar } from '../contacts/CloudContactAvatar';
import type { ProgramActor } from '../program/ProgramSummary';
import { Avatar, Text } from '../ui';
import { WorkoutPlanCard } from './WorkoutPlanCard';
import type { NavigationContext } from '../NavigationShell';

/** The program remains read-only while picking a source for an ad-hoc session. */
export function AdHocProgramPicker({ repository, programs, actor, busy, onStart, onBack, onNavigationContextChange }: {
  repository: AdHocWorkoutRepository;
  programs: readonly CloudTrainingPlanRow[];
  actor?: ProgramActor;
  busy: boolean;
  onStart: (programId: string, dayId: string) => void;
  onBack: () => void;
  onNavigationContextChange: (value: NavigationContext | null) => void;
}) {
  const cloud = useCloudConnections();
  const [programId, setProgramId] = useState<string | null>(null);
  const [details, setDetails] = useState<ProgramDetails | null>(null);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const back = useCallback(() => {
    if (busy) return;
    if (programId) setProgramId(null); else onBack();
  }, [busy, programId, onBack]);
  useEffect(() => {
    onNavigationContextChange({ level: 2, title: programId ? 'Выбрать день' : 'Выбрать программу',
      contentMode: 'viewport', onBack: back });
    return () => onNavigationContextChange(null);
  }, [programId, back, onNavigationContextChange]);
  useEffect(() => {
    setDetails(null); setError('');
    if (!programId) return;
    let active = true;
    const subscription = repository.programs.observeDetails(programId,
      value => { if (active) { setDetails(value); if (!value) setError('Программа недоступна'); } },
      reason => { if (active) setError(reason instanceof Error ? reason.message : 'Не удалось прочитать программу'); });
    return () => { active = false; subscription.unsubscribe(); };
  }, [repository, programId, retry]);
  const author = useMemo(() => {
    const program = details?.program;
    const authorId = program ? planAuthorUserId(program) : repository.actorUserId;
    const self = authorId === repository.actorUserId;
    const contact = [...(cloud?.selfAvatars ?? []), ...(cloud?.clients ?? []), ...(cloud?.coaches ?? [])]
      .find(person => person.userId === authorId && person.relationshipId === program?.realmId);
    const name = self ? actor?.name || 'Вы' : contact?.displayName || 'Автор программы';
    return { name, avatar: contact ? <CloudContactAvatar contact={contact} />
      : <Avatar name={name} src={self ? actor?.photoUrl ?? undefined : undefined} /> };
  }, [details?.program, repository.actorUserId, cloud?.selfAvatars, cloud?.clients, cloud?.coaches, actor]);
  return <section className="workout-planning-sheet">
    <header className="workout-planning-sheet__header">
      <Text variant="headline">{programId ? 'Выбрать день' : 'Выбрать программу'}</Text>
      <Button clear inline disabled={busy} onClick={back}>Назад</Button>
    </header>
    {!programId ? <List nested>{programs.map(program => <ListItem key={program.id} link title={program.name}
      onClick={() => { if (!busy) setProgramId(program.id); }} />)}</List> : null}
    {programId && !details && !error ? <Text variant="body">Загружаем программу…</Text> : null}
    {error ? <><Text variant="footnote" role="alert">{error}</Text>
      <Button tonal disabled={busy} onClick={() => setRetry(value => value + 1)}>Повторить</Button></> : null}
    {details ? <>
      <Text variant="headline">{details.program.name}</Text>
      {details.phases.map(phase => <section key={phase.id} className="adhoc-workouts__phase">
        <Text variant="headline">{phase.name}</Text>
        {(details.days ?? []).filter(day => day.day.programPhaseId === phase.id && day.day.status === 'active')
          .map(day => <WorkoutPlanCard key={day.day.id} mode="planning" day={day} programName={details.program.name}
            creatorName={author.name} creatorAvatar={author.avatar} readOnly busy={busy}
            onStart={() => onStart(details.program.id, day.day.id)}
            onEdit={() => {}} onComment={() => {}} onMove={() => {}} onDuplicate={() => {}} onDelete={() => {}} />)}
      </section>)}
      {!(details.days ?? []).some(day => day.day.status === 'active') ? <Text variant="body">В программе пока нет дней</Text> : null}
    </> : null}
  </section>;
}
