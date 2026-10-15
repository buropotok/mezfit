import { ExerciseCatalogContent } from './ExerciseCatalogContent';
import { usePublishedExerciseCatalogue } from './usePublishedExerciseCatalogue';
import type { NavigationContext } from '../NavigationShell';
import { Surface, Text } from '../ui';

/** Shared read-only surface: Coach and Client see the same public Dexie Cloud catalogue. */

export function PublicExercises({
  onNavigationContextChange,
  mode = 'browse', selectedExerciseIds, onToggleExercise, selectionDisabled = false,
}: {
  onNavigationContextChange?: (context: NavigationContext | null) => void;
  mode?: 'browse' | 'select';
  selectedExerciseIds?: ReadonlySet<string>;
  onToggleExercise?: (id: string) => void;
  selectionDisabled?: boolean;
}) {
  const { cloud, snapshot, error } = usePublishedExerciseCatalogue();
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
    <ExerciseCatalogContent snapshot={snapshot} onNavigationContextChange={onNavigationContextChange}
      mode={mode} selectedExerciseIds={selectedExerciseIds} onToggleExercise={onToggleExercise}
      selectionDisabled={selectionDisabled} />
  </>;
}
