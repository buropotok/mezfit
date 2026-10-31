import { useEffect, useMemo, useState } from 'react';
import type { CloudContact } from '../data/cloud/CloudConnectionsProvider';
import { useCloudConnections } from '../data/cloud/CloudConnectionsProvider';
import { AdHocWorkoutRepository, type PerformedClientExercise } from '../data/cloud/adhoc-workouts';
import { Button, GlassSurface, List, ListItem, Text } from '../ui';

/** Read-only FACT history for the currently selected Coach/Client relationship. */
export function ClientPerformedExercisesPage({ client }: { client: CloudContact }) {
  const cloud = useCloudConnections();
  const repository = useMemo(() => cloud
    ? new AdHocWorkoutRepository(cloud.db, cloud.actorUserId) : null,
  [cloud?.db, cloud?.actorUserId]);
  const [exercises, setExercises] = useState<PerformedClientExercise[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    if (!repository) return undefined;
    let active = true;
    setLoading(true);
    setExercises([]);
    setError('');
    const subscription = repository.observePerformedClientExercises(
      client.userId, client.relationshipId,
      (rows) => {
        if (!active) return;
        setExercises(rows);
        setLoading(false);
        setError('');
      },
      (reason) => {
        if (!active) return;
        setExercises([]);
        setLoading(false);
        setError(reason instanceof Error ? reason.message : 'Не удалось загрузить упражнения');
      },
    );
    return () => { active = false; subscription.unsubscribe(); };
  }, [repository, client.userId, client.relationshipId, retryKey]);

  return (
    <GlassSurface component="section" preset="modalTuned" optics={false} blur={2}
      shape={{ radius: 16 }} wrapContent={false} className="client-workspace-surface">
      <Text variant="footnote" tone="muted">Выполненные упражнения в тренировках с этим тренером</Text>
      {!repository || loading ? <Text variant="body" tone="muted">Загружаем упражнения…</Text> : null}
      {error ? <>
        <Text variant="body" role="alert">{error}</Text>
        <Button onClick={() => setRetryKey(value => value + 1)}>Повторить</Button>
      </> : null}
      {!loading && !error && exercises.length === 0
        ? <Text variant="body" tone="muted">В доступной истории пока нет выполненных упражнений.</Text>
        : null}
      {exercises.length > 0 ? <List>{exercises.map(exercise => (
        <ListItem key={exercise.key} title={exercise.name} interactive={false} />
      ))}</List> : null}
    </GlassSurface>
  );
}
