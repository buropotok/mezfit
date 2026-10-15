import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useCloudConnections } from '../data/cloud/CloudConnectionsProvider';
import { CoachExerciseCatalogueRepository } from '../data/exercises/coachExerciseCatalogue';
import {
  resolveCoachExerciseCatalogue, type CoachExercisePersonalSnapshot,
} from '../data/exercises/coachExerciseTypes';
import type { NavigationContext } from '../NavigationShell';
import { Surface, Text } from '../ui';
import { CoachExerciseEditorGateway, type CoachExerciseEditorRequest } from './CoachExerciseEditorGateway';
import { ExerciseCatalogContent } from './ExerciseCatalogContent';
import { usePublishedExerciseCatalogue } from './usePublishedExerciseCatalogue';

/** Coach-only catalogue: immutable public records overlaid with private Dexie Cloud rows. */
export function CoachExercises({ onNavigationContextChange }: {
  onNavigationContextChange: (context: NavigationContext | null) => void;
}) {
  const { cloud, snapshot, error } = usePublishedExerciseCatalogue();
  const repository = useMemo(() => cloud
    ? new CoachExerciseCatalogueRepository(cloud.db, cloud.actorUserId) : null,
  [cloud?.db, cloud?.actorUserId]);
  const [personal, setPersonal] = useState<CoachExercisePersonalSnapshot | null>(null);
  const [personalError, setPersonalError] = useState('');
  const [actionError, setActionError] = useState('');
  const [editorRequest, setEditorRequest] = useState<CoachExerciseEditorRequest | null>(null);
  const busyFavourites = useRef(new Set<string>());

  useEffect(() => {
    setPersonal(null);
    setPersonalError('');
    if (!repository) return undefined;
    let active = true;
    const subscription = repository.observe(
      next => { if (active) { setPersonal(next); setPersonalError(''); } },
      reason => { if (active) setPersonalError(reason instanceof Error ? reason.message : 'Ошибка личного каталога'); },
    );
    return () => { active = false; subscription.unsubscribe(); };
  }, [repository]);

  const merged = useMemo(() => snapshot?.status === 'ready' && personal && cloud
    ? resolveCoachExerciseCatalogue(snapshot.exercises, personal, cloud.actorUserId) : null,
  [snapshot, personal, cloud?.actorUserId]);

  const toggleFavourite = useCallback(async (id: string) => {
    if (!repository || !merged || busyFavourites.current.has(id)) return;
    busyFavourites.current.add(id);
    setActionError('');
    try {
      await repository.setFavourite(id, !merged.favouriteIds.has(id));
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : 'Не удалось изменить избранное');
    } finally {
      busyFavourites.current.delete(id);
    }
  }, [repository, merged]);

  const create = useCallback(() => setEditorRequest({ mode: 'create', category: null }), []);
  const edit = useCallback((exerciseId: string) => setEditorRequest({ mode: 'edit', exerciseId }), []);

  const ready = snapshot?.status === 'ready';
  if (!cloud || (cloud.status === 'loading' && !ready) || snapshot === null || personal === null) {
    return <Text tone="muted">Загружаем каталог тренера…</Text>;
  }
  if (error || personalError || (cloud.status === 'error' && !ready)) {
    return <Surface><Text role="alert">{error || personalError || cloud.error || 'Не удалось открыть каталог'}</Text></Surface>;
  }
  if (snapshot.status === 'unpublished') return <Surface><Text>Публичный каталог ещё не синхронизирован.</Text></Surface>;
  if (snapshot.status === 'invalid' || snapshot.status === 'incomplete') {
    return <Surface><Text role="alert">Публичный каталог не прошёл проверку целостности.</Text></Surface>;
  }
  if (!merged) return <Surface><Text role="alert">Личный каталог недоступен.</Text></Surface>;

  return <>
    {cloud.status === 'error' ? <Text variant="footnote" tone="muted">Офлайн: показаны сохранённые упражнения</Text> : null}
    {actionError ? <Text role="alert" variant="footnote">{actionError}</Text> : null}
    <ExerciseCatalogContent
      snapshot={snapshot}
      scope="coach"
      catalogueExercises={merged.exercises}
      favouriteIds={merged.favouriteIds}
      onToggleFavourite={id => { void toggleFavourite(id); }}
      onCreateExercise={create}
      onEditExercise={edit}
      onNavigationContextChange={onNavigationContextChange}
    />
    <CoachExerciseEditorGateway request={editorRequest} onClose={() => setEditorRequest(null)} />
  </>;
}
