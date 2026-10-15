import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { NavigationContext } from '../NavigationShell';
import { coachFavouriteId, resolveCoachExerciseCatalogue, type CoachExercisePersonalSnapshot } from '../data/exercises/coachExerciseTypes';
import { CoachExerciseCatalogueRepository } from '../data/exercises/coachExerciseCatalogue';
import { AssignedCoachExercisesRepository, type AssignedCoachExerciseRow } from '../data/exercises/assignedCoachExercises';
import { Surface, Text } from '../ui';
import { ExerciseCatalogContent } from './ExerciseCatalogContent';
import { PersonalExerciseEditorGateway, type PersonalExerciseEditorRequest } from './PersonalExerciseEditorGateway';
import { usePublishedExerciseCatalogue } from './usePublishedExerciseCatalogue';

export function PersonalExercises({
  role, selectedCoachUserId = null, onNavigationContextChange,
}: {
  role: 'coach' | 'client';
  selectedCoachUserId?: string | null;
  onNavigationContextChange: (context: NavigationContext | null) => void;
}) {
  const { cloud, snapshot, error } = usePublishedExerciseCatalogue();
  const repository = useMemo(() => cloud
    ? new CoachExerciseCatalogueRepository(cloud.db, cloud.actorUserId) : null,
  [cloud?.db, cloud?.actorUserId]);
  const assignedRepository = useMemo(() => role === 'client' && cloud
    ? new AssignedCoachExercisesRepository(cloud.db, cloud.actorUserId) : null,
  [role, cloud?.db, cloud?.actorUserId]);

  const [personal, setPersonal] = useState<CoachExercisePersonalSnapshot | null>(null);
  const [assigned, setAssigned] = useState<AssignedCoachExerciseRow[] | null>(null);
  const [personalError, setPersonalError] = useState('');
  const [assignedError, setAssignedError] = useState('');
  const [actionError, setActionError] = useState('');
  const [request, setRequest] = useState<PersonalExerciseEditorRequest | null>(null);
  const [catalogueKey, setCatalogueKey] = useState(0);
  const [initialTab, setInitialTab] = useState<'all' | 'mine'>('all');
  const pendingFavourites = useRef(new Set<string>());

  useEffect(() => {
    setPersonal(null);
    setPersonalError('');
    if (!repository) return undefined;
    let active = true;
    const observer = repository.observe(
      next => { if (active) { setPersonal(next); setPersonalError(''); } },
      cause => { if (active) setPersonalError(cause instanceof Error ? cause.message : 'Ошибка личного каталога'); },
    );
    return () => { active = false; observer.unsubscribe(); };
  }, [repository]);

  useEffect(() => {
    setAssigned(role === 'coach' ? [] : null);
    setAssignedError('');
    if (!assignedRepository) return undefined;
    let active = true;
    const observer = assignedRepository.observe(selectedCoachUserId,
      next => { if (active) { setAssigned(next); setAssignedError(''); } },
      cause => { if (active) setAssignedError(cause instanceof Error ? cause.message : 'Ошибка тренерских упражнений'); },
    );
    return () => { active = false; observer.unsubscribe(); };
  }, [assignedRepository, role, selectedCoachUserId]);

  const merged = useMemo(() => snapshot?.status === 'ready' && personal && cloud
    ? resolveCoachExerciseCatalogue(snapshot.exercises, personal, cloud.actorUserId) : null,
  [snapshot, personal, cloud?.actorUserId]);

  const assignedIds = useMemo(() => new Set((assigned ?? []).map(row => row.id)), [assigned]);
  const personalIds = useMemo(() => new Set(merged?.exercises
    .filter(row => row.owner === cloud?.actorUserId).map(row => row.id) ?? []), [merged, cloud?.actorUserId]);

  const favouriteIds = useMemo(() => {
    const ids = new Set(merged?.favouriteIds ?? []);
    if (personal && cloud) {
      for (const row of personal.favourites) {
        if (assignedIds.has(row.exerciseId) && row.realmId === cloud.actorUserId
          && row.owner === cloud.actorUserId
          && row.id === coachFavouriteId(cloud.actorUserId, row.exerciseId)) {
          ids.add(row.exerciseId);
        }
      }
    }
    return ids;
  }, [merged, personal, cloud?.actorUserId, assignedIds]);

  const toggleFavourite = useCallback(async (id: string) => {
    if (!repository || pendingFavourites.current.has(id)) return;
    pendingFavourites.current.add(id);
    setActionError('');
    try {
      await repository.setFavourite(id, !favouriteIds.has(id),
        assignedIds.has(id) ? selectedCoachUserId ?? undefined : undefined);
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : 'Не удалось изменить избранное');
    } finally {
      pendingFavourites.current.delete(id);
    }
  }, [repository, favouriteIds, assignedIds, selectedCoachUserId]);

  const edit = useCallback((exerciseId: string) => {
    if (personalIds.has(exerciseId)) {
      setRequest({ mode: 'edit', exerciseId });
    } else if (assignedIds.has(exerciseId)) {
      setRequest({ mode: 'copy', source: 'trainer', exerciseId });
    } else {
      setRequest({ mode: 'copy', source: 'public', exerciseId });
    }
  }, [personalIds, assignedIds]);

  const ready = snapshot?.status === 'ready';
  if (error || personalError || assignedError || (cloud?.status === 'error' && !ready)) {
    return <Surface><Text role="alert">{error || personalError || assignedError || cloud?.error || 'Не удалось открыть каталог'}</Text></Surface>;
  }
  if (!cloud || (cloud.status === 'loading' && !ready)
    || snapshot === null || personal === null || assigned === null) {
    return <Text tone="muted">Загружаем каталог упражнений…</Text>;
  }
  if (snapshot.status === 'unpublished') {
    return <Surface><Text>Общая база упражнений ещё не синхронизирована.</Text></Surface>;
  }
  if (snapshot.status === 'invalid' || snapshot.status === 'incomplete') {
    return <Surface><Text role="alert">Общая база упражнений не прошла проверку целостности.</Text></Surface>;
  }
  if (!repository || !merged) return <Surface><Text role="alert">Личный каталог недоступен.</Text></Surface>;

  const combined = [...merged.exercises, ...assigned.filter(row => !personalIds.has(row.id))];

  return <>
    {cloud.status === 'error'
      ? <Text variant="footnote" tone="muted">Офлайн: отображаются сохранённые упражнения</Text> : null}
    {actionError ? <Text role="alert" variant="footnote">{actionError}</Text> : null}
    <ExerciseCatalogContent
      key={catalogueKey}
      snapshot={snapshot}
      scope={role}
      initialTab={initialTab}
      catalogueExercises={combined}
      personalIds={personalIds}
      assignedIds={assignedIds}
      favouriteIds={favouriteIds}
      selectedCoachUserId={selectedCoachUserId}
      onToggleFavourite={id => { void toggleFavourite(id); }}
      onCreateExercise={category => setRequest({ mode: 'create', category })}
      onEditExercise={edit}
      onNavigationContextChange={onNavigationContextChange}
    />
    <PersonalExerciseEditorGateway
      request={request}
      repository={repository}
      rows={personal.definitions}
      selectedCoachUserId={selectedCoachUserId}
      onCreated={() => {
        setRequest(null);
        setInitialTab('mine');
        setCatalogueKey(previous => previous + 1);
      }}
      onClose={() => setRequest(null)}
    />
  </>;
}
