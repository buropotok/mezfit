import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { useCloudConnections, type CloudContact } from '../data/cloud/CloudConnectionsProvider';
import { AdHocWorkoutRepository, type ClientExerciseFact, type CalendarWorkoutSession } from '../data/cloud/adhoc-workouts';
import { WorkoutOccurrenceDraftRepository } from '../data/cloud/workout-occurrence-drafts';
import type { CloudWorkoutOccurrenceRow } from '../data/cloud/workout-foundation-types';
import type { ExercisePeriod } from '../coach/clientExerciseStatistics';
import type { LocalDate } from '../ui';
import type { ProfileTab } from './ProfileWorkspace';

type Observe<T> = (next: (data: T) => void, error: (reason: unknown) => void) => { unsubscribe(): void };
type Snapshot<T> = { data: T | null; failed: boolean };
const pending = { data: null, failed: false };

function useProfileRead<T>(requested: boolean, observe: Observe<T> | null) {
  const [started, setStarted] = useState(requested);
  const [snapshot, setSnapshot] = useState<Snapshot<T>>(pending);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => { if (requested) setStarted(true); }, [requested]);
  useEffect(() => {
    if (!started || !observe) return;
    let active = true;
    const onError = () => {
      if (active) setSnapshot(previous => ({ ...previous, failed: true }));
    };
    let subscription: ReturnType<Observe<T>> | undefined;
    try {
      subscription = observe(data => {
        if (active) setSnapshot({ data, failed: false });
      }, onError);
    } catch {
      onError();
    }
    return () => { active = false; subscription?.unsubscribe(); };
  }, [started, observe, attempt]);

  return { ...snapshot, retry: () => {
    if (!snapshot.failed) return;
    setSnapshot(previous => ({ ...previous, failed: false }));
    setAttempt(previous => previous + 1);
  } };
}

type Workouts = { occurrences: CloudWorkoutOccurrenceRow[]; sessions: CalendarWorkoutSession[] };
type HistoryFilter = { from: LocalDate | null; to: LocalDate | null };
type ExerciseFilter = { period: ExercisePeriod; anchor: Date; anchorDay: number; category: string | null };
type Cloud = NonNullable<ReturnType<typeof useCloudConnections>>;

function useProfileData(cloud: Cloud | null, tab: ProfileTab, clientUserId?: string, realmId?: string) {
  const db = cloud?.db;
  const actorUserId = cloud?.actorUserId;
  const observeWorkouts = useCallback<Observe<Workouts>>((next, error) => {
    if (!db || !actorUserId) throw new Error('Profile database unavailable');
    const belongs = (row: { athleteUserId: string; realmId: string }) =>
      clientUserId ? row.athleteUserId === clientUserId && row.realmId === realmId : row.athleteUserId === actorUserId;
    return new WorkoutOccurrenceDraftRepository(db, actorUserId).observeWorkspace(value => {
      next({
        occurrences: value.occurrences.filter(row => row.entryKind !== 'personal_event' && belongs(row)),
        sessions: (value.sessions ?? []).filter(belongs),
      });
    }, error);
  }, [db, actorUserId, clientUserId, realmId]);
  const observeFacts = useCallback<Observe<ClientExerciseFact[]>>((next, error) => {
    if (!db || !actorUserId) throw new Error('Profile database unavailable');
    const repository = new AdHocWorkoutRepository(db, actorUserId);
    return clientUserId && realmId
      ? repository.observeClientExerciseFacts(clientUserId, realmId, next, error)
      : repository.observeOwnExerciseFacts(next, error);
  }, [db, actorUserId, clientUserId, realmId]);
  const workouts = useProfileRead(tab === 'calendar' || tab === 'history', db ? observeWorkouts : null);
  const exercises = useProfileRead(tab === 'exercises', db ? observeFacts : null);
  const [historyFilter, setHistoryFilter] = useState<HistoryFilter>({ from: null, to: null });
  const [exerciseFilter, setExerciseFilter] = useState<ExerciseFilter>(() => {
    const anchor = new Date();
    return { period: '30d', anchor, anchorDay: anchor.getDate(), category: null };
  });
  return { workouts, exercises, historyFilter, setHistoryFilter, exerciseFilter, setExerciseFilter };
}

const ProfileDataContext = createContext<ReturnType<typeof useProfileData> | null>(null);

function ProfileDataScope({ cloud, tab, contact, children }: {
  cloud: Cloud | null; tab: ProfileTab; contact?: CloudContact; children: ReactNode;
}) {
  const value = useProfileData(cloud, tab, contact?.userId, contact?.relationshipId);
  return <ProfileDataContext.Provider value={value}>{children}</ProfileDataContext.Provider>;
}

export function ProfileDataProvider({ tab, contact, expectedActor, children }: {
  tab: ProfileTab; contact?: CloudContact; expectedActor?: string; children: ReactNode;
}) {
  const connection = useCloudConnections();
  const cloud = connection?.db && (!expectedActor || connection.actorUserId === expectedActor) ? connection : null;
  const db = cloud?.db;
  const [databaseScope, setDatabaseScope] = useState({ db, revision: 0 });
  // React restarts this render before rendering children if the DB instance changed.
  if (databaseScope.db !== db) {
    setDatabaseScope({ db, revision: databaseScope.revision + 1 });
  }
  const accessRealms = contact ? [contact.relationshipId] : (cloud?.coaches ?? [])
    .map(coach => coach.relationshipId).sort();
  return <ProfileDataScope key={JSON.stringify([databaseScope.revision, cloud?.actorUserId, contact?.userId, accessRealms])}
    cloud={cloud} tab={tab} contact={contact}>{children}</ProfileDataScope>;
}

export function useProfileDataContext() {
  return useContext(ProfileDataContext);
}

export function useProfileSnapshot() {
  const value = useProfileDataContext();
  if (!value) throw new Error('ProfileDataProvider is missing');
  return value;
}
