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
import { AdHocSessionScreen } from '../workout/AdHocSessionScreen';
import { AdHocWorkoutRepository } from '../data/cloud/adhoc-workouts';
import { ClientWorkoutRepository } from '../data/cloud/client-workouts';
import { getTelegramWebApp } from '../telegram';
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
    sessions: role === 'coach' ? new AdHocWorkoutRepository(cloud.db, cloud.actorUserId)
      : new ClientWorkoutRepository(cloud.db, cloud.actorUserId),
  } : null, [cloud?.db, cloud?.actorUserId, role]);
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
  if (target.kind === 'occurrence') {
    const draft = target.draft;
    // Match the calendar editor's participant/format rules; repositories still
    // enforce structural and PLAN-authoring permissions on every mutation.
    const editable = (!draft.executionStatus || draft.executionStatus === 'scheduled')
      && !draft.workoutSessionId
      && (draft.athleteUserId === cloud.actorUserId || draft.coachUserId === cloud.actorUserId)
      && (draft.format !== 'coached' || draft.coachUserId === cloud.actorUserId);
    return <OccurrenceDraftSheet draft={draft} drafts={repositories.drafts}
      focusExerciseId={target.focus?.exerciseId} focusSetId={target.focus?.setId}
      readOnly={!editable} onClose={onBack}
      onSave={async (selected, updateProgram) => {
        const latest = await repositories.drafts.get(selected.id);
        if (!latest) throw new Error('Тренировка недоступна');
        await repositories.drafts.save(selected.id);
        if (updateProgram && latest.trainingPlanId && latest.programDayId)
          await repositories.programs.applyOccurrencePlan(latest.trainingPlanId, latest.programDayId,
            latest.plan, latest.originalPlan);
      }}
      onNavigationContextChange={setNested} />;
  }
  return <AdHocSessionScreen repository={repositories.sessions} sessionId={target.session.sessionId}
    initData={getTelegramWebApp()?.initData ?? ''} personalCatalogueRole={role}
    focusExerciseId={target.focus?.exerciseId} focusSetId={target.focus?.setId}
    onExerciseInformation={exerciseId => repositories.sessions.exerciseInformation(target.session.sessionId, exerciseId)}
    onNavigationContextChange={setNested} />;
}
