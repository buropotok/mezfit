import { useEffect, useMemo, useState } from 'react';
import { useCloudConnections } from '../data/cloud/CloudConnectionsProvider';
import { PublicExerciseCatalogueRepository, type PublicExerciseSnapshot } from '../data/exercises/publicExerciseCatalogue';
import { ExerciseCatalogContent } from './ExerciseCatalogContent';
import type { NavigationContext } from '../NavigationShell';
import { Surface, Text } from '../ui';

/** The same locally synced public catalogue powers browsing and workout selection. */
export interface PublicExercisesProps {
  onNavigationContextChange?: (context: NavigationContext | null) => void;
  mode?: 'browse' | 'select';
  selectedExerciseIds?: ReadonlySet<string>;
  onToggleExercise?: (exerciseId: string) => void;
  selectionDisabled?: boolean;
}

export function PublicExercises({
  onNavigationContextChange, mode = 'browse', selectedExerciseIds, onToggleExercise, selectionDisabled = false,
}: PublicExercisesProps) {
  const cloud = useCloudConnections();
  const repository = useMemo(() => cloud ? new PublicExerciseCatalogueRepository(cloud.db) : null, [cloud?.db]);
  const [snapshot, setSnapshot] = useState<PublicExerciseSnapshot | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    setSnapshot(null);
    setError('');
    if (!repository) return undefined;
    let active = true;
    const observer = repository.observe(
      (next) => { if (active) { setSnapshot(next); setError(''); } },
      (cause) => { if (active) setError(cause instanceof Error ? cause.message : 'Ошибка локальной базы'); },
    );
    return () => { active = false; observer.unsubscribe(); };
  }, [repository]);

  const ready = snapshot?.status === 'ready';
  // Publication state is only authoritative after the account's initial cloud pull.
  if (!cloud || (cloud.status === 'loading' && !ready) || snapshot === null) {
    return <Text tone="muted">Загружаем локальную базу упражнений…</Text>;
  }
  if (error || (cloud.status === 'error' && !ready)) return <Surface><Text role="alert">{error || cloud.error || 'Нет подключения к каталогу'}</Text></Surface>;
  if (snapshot.status === 'unpublished') return <Surface><Text>Глобальный каталог ещё не опубликован или не синхронизирован.</Text></Surface>;
  if (snapshot.status === 'invalid') return <Surface><Text role="alert">Не удалось проверить опубликованный каталог. Данные некорректны.</Text></Surface>;
  if (snapshot.status === 'incomplete') return <Surface><Text role="alert">Публикация каталога неполная. Показывать частичные данные небезопасно.</Text></Surface>;
  return <>
    {cloud.status === 'error' ? <Text variant="footnote" tone="muted">Офлайн: показаны сохранённые упражнения</Text> : null}
    <ExerciseCatalogContent
      snapshot={snapshot}
      onNavigationContextChange={onNavigationContextChange}
      mode={mode}
      selectedExerciseIds={selectedExerciseIds}
      onToggleExercise={onToggleExercise}
      selectionDisabled={selectionDisabled}
    />
  </>;
}
