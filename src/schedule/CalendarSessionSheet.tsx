import { useEffect, useMemo, useState } from 'react';
import type { NavigationContext } from '../NavigationShell';
import { useCloudConnections } from '../data/cloud/CloudConnectionsProvider';
import { ClientWorkoutRepository } from '../data/cloud/client-workouts';
import { AdHocWorkoutRepository } from '../data/cloud/adhoc-workouts';
import type { ProgramActor } from '../program/ProgramSummary';
import { IconButton, MezfitBottomSheet, Text } from '../ui';
import { AdHocSessionScreen } from '../workout/AdHocSessionScreen';
import './calendar-session-sheet.css';

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
  const [headerActionsHost, setHeaderActionsHost] = useState<HTMLDivElement | null>(null);
  useEffect(() => { if (sessionId) setRetained(sessionId); }, [sessionId]);
  const id = sessionId ?? retained;
  return <MezfitBottomSheet opened={Boolean(sessionId)} label="Тренировка" lazyMount
    onClosed={() => { if (!sessionId) setRetained(null); }}>
    <div className="calendar-session-sheet">
      <header className="calendar-session-sheet__header">
        <Text variant="headline" className="calendar-session-sheet__title">Тренировка</Text>
        <div ref={setHeaderActionsHost} className="calendar-session-sheet__actions" role="group" aria-label="Действия тренировки" />
        <IconButton label="Закрыть тренировку" onClick={onClose}>✕</IconButton>
      </header>
      <div className="calendar-session-sheet__body">
        {id && repository ? <AdHocSessionScreen key={id} repository={repository} sessionId={id} initData={initData}
          actor={actor} personalCatalogueRole={role} sheetLayout headerActionsHost={headerActionsHost}
          onNavigationContextChange={onNavigationContextChange}
          onExerciseInformation={exerciseId => repository.exerciseInformation(id, exerciseId)} /> : null}
      </div>
    </div>
  </MezfitBottomSheet>;
}
