import { useEffect, useMemo, useState } from 'react';
import { useCloudConnections } from '../data/cloud/CloudConnectionsProvider';
import { PublicExerciseCatalogueRepository, type PublicExerciseSnapshot } from '../data/exercises/publicExerciseCatalogue';

/** Shared read-only public source; the coach overlay is owned by CoachExercises. */
export function usePublishedExerciseCatalogue() {
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

  return { cloud, snapshot, error };
}
