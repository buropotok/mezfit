import { useEffect, useMemo, useState } from 'react';
import { Button } from 'konsta/react';
import type { NavigationContext } from '../NavigationShell';
import type { DiscussionThread } from '../data/cloud/discussion-contracts';
import { observeDiscussionDestination, type DiscussionDestination } from '../data/cloud/discussion-destination';
import { useCloudConnections } from '../data/cloud/CloudConnectionsProvider';
import { ProgramManagementRepository } from '../data/cloud/program-management';
import { WorkoutOccurrenceDraftRepository } from '../data/cloud/workout-occurrence-drafts';
import { CloudProgramDetailsPage } from '../program/CloudProgramDetailsPage';
import { OccurrenceDraftSheet } from '../schedule/OccurrenceDraftSheet';
import { WorkoutSessionCard } from '../workout/WorkoutSessionCard';
import { Text } from '../ui';

export function DiscussionEntity({ thread, role, onBack, onNavigationContextChange }: {
  thread: DiscussionThread; role: 'coach' | 'client'; onBack: () => void;
  onNavigationContextChange: (value: NavigationContext | null) => void;
}) {
  const cloud = useCloudConnections();
  const [target, setTarget] = useState<DiscussionDestination | null>(null);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [nested, setNested] = useState<NavigationContext | null>(null);
  const repositories = useMemo(() => cloud ? {
    programs: new ProgramManagementRepository(cloud.db, cloud.actorUserId),
    drafts: new WorkoutOccurrenceDraftRepository(cloud.db, cloud.actorUserId),
  } : null, [cloud?.db, cloud?.actorUserId]);
  useEffect(() => {
    setTarget(null); setError('');
    if (!cloud) return;
    let active = true;
    const sub = observeDiscussionDestination(cloud.db, cloud.actorUserId, role, thread,
      target => { if (active) setTarget(target); },
      () => { if (active) { setTarget(null); setError('Не удалось открыть сущность'); } });
    return () => { active = false; sub.unsubscribe(); };
  }, [cloud?.db, cloud?.actorUserId, role, thread, retry]);
  useEffect(() => {
    onNavigationContextChange(nested ?? { level: 2, title: thread.derivedTitleSnapshot, onBack,
      scrollKey: 'discussion-entity:' + thread.anchorKey });
    return () => onNavigationContextChange(null);
  }, [nested, thread, onBack, onNavigationContextChange]);
  if (error) return <div className="stack"><Text role="alert">{error}</Text>
    <Button rounded tonal onClick={() => setRetry(value => value + 1)}><Text>Повторить</Text></Button></div>;
  if (!target || !cloud || !repositories) return <Text>Загружаем сущность…</Text>;
  if (target.kind === 'unavailable') return <Text>Сущность удалена или недоступна на этом устройстве. Переписка сохранена.</Text>;
  if (target.kind === 'program') return <CloudProgramDetailsPage repository={repositories.programs} planId={target.id}
    viewerRole={role} readOnly={role === 'client'} cloudStatus={cloud.status} cloudError={cloud.error}
    syncStatus={cloud.syncStatus} syncError={cloud.syncError} onRetryCloud={cloud.refresh} onRetrySync={cloud.retrySync}
    onNavigationContextChange={setNested} />;
  if (target.kind === 'occurrence') return <OccurrenceDraftSheet draft={target.draft} drafts={repositories.drafts}
    readOnly onClose={onBack} onSave={async () => {}} onNavigationContextChange={setNested} />;
  return <WorkoutSessionCard readOnly session={target.session} title={target.name} comment={target.comment}
    initiallyExpanded={thread.anchor.kind === 'exercise' || thread.anchor.kind === 'set'}
    onReorderExerciseIds={() => {}} onSaveSet={async () => {}}
    onNavigationContextChange={setNested} />;
}
