import { useEffect, useMemo, useState } from 'react';
import type { NavigationContext } from '../NavigationShell';
import { useCloudConnections } from '../data/cloud/CloudConnectionsProvider';
import { ClientWorkoutRepository } from '../data/cloud/client-workouts';
import { AdHocWorkoutRepository } from '../data/cloud/adhoc-workouts';
import type { ProgramActor } from '../program/ProgramSummary';
import { IconButton, MezfitBottomSheet, Text } from '../ui';
import { AdHocSessionScreen } from '../workout/AdHocSessionScreen';

/** Open the exact calendar execution, including completed history, without changing tabs. */
export function CalendarSessionSheet({ sessionId, role, actor, initData, onClose, onNavigationContextChange }: {
  sessionId: string | null; role: 'coach' | 'client'; actor?: ProgramActor; initData: string;
  onClose: () => void; onNavigationContextChange: (value: NavigationContext | null) => void;
}) {
  const cloud = useCloudConnections();
  const repository = useMemo(() => cloud ? role === 'client' ? new ClientWorkoutRepository(cloud.db, cloud.actorUserId)
    : new AdHocWorkoutRepository(cloud.db, cloud.actorUserId) : null,
    [role, cloud?.db, cloud?.actorUserId]);
  const [retained, setRetained] = useState(sessionId);
  useEffect(() => { if (sessionId) setRetained(sessionId); }, [sessionId]);
  const id = sessionId ?? retained;
  return <MezfitBottomSheet opened={Boolean(sessionId)} label="Тренировка" lazyMount
    onClosed={() => { if (!sessionId) setRetained(null); }}>
    <div className="calendar-session-sheet">
      <header className="calendar-session-sheet__header"><Text variant="headline">Тренировка</Text>
        <IconButton label="Закрыть тренировку" onClick={onClose}>✕</IconButton></header>
      {id && repository ? <AdHocSessionScreen key={id} repository={repository} sessionId={id} initData={initData}
        actor={actor} personalCatalogueRole={role} onNavigationContextChange={onNavigationContextChange}
        onExerciseInformation={exerciseId => repository.exerciseInformation(id, exerciseId)} /> : null}
    </div>
  </MezfitBottomSheet>;
}
