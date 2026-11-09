import { useEffect, useMemo, useRef, useState } from 'react';
import {
  DEFAULT_WEIGHT_REPS_PICKER_MODE, type WeightRepsPickerMode,
} from '../../shared/weight-reps-picker-mode';
import { useCloudConnections } from '../data/cloud/CloudConnectionsProvider';
import { WeightRepsPickerPreferencesRepository } from '../data/cloud/weight-reps-picker-preferences';

/** Set-entry composition owns UI state; the typed preference repository owns persistence. */
export function useWeightRepsPickerMode(onError: (message: string) => void) {
  const cloud = useCloudConnections();
  const repository = useMemo(() => cloud
    ? new WeightRepsPickerPreferencesRepository(cloud.db, cloud.actorUserId) : null,
  [cloud?.db, cloud?.actorUserId]);
  const [mode, setMode] = useState<WeightRepsPickerMode>(DEFAULT_WEIGHT_REPS_PICKER_MODE);
  const [ready, setReady] = useState(!repository);
  const generationRef = useRef(0);
  const pendingRef = useRef(0);
  const queueRef = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    const generation = ++generationRef.current;
    pendingRef.current = 0;
    queueRef.current = Promise.resolve();
    setMode(DEFAULT_WEIGHT_REPS_PICKER_MODE);
    setReady(!repository);
    if (!repository) return () => { generationRef.current++; };

    const subscription = repository.observe(
      next => {
        if (generationRef.current !== generation) return;
        setReady(true);
        // Replication must not overwrite a newer, locally selected mode.
        if (pendingRef.current === 0) setMode(next);
      },
      () => {
        if (generationRef.current !== generation) return;
        setReady(true);
        onError('Не удалось загрузить режим пикера. Используется режим по умолчанию.');
      },
    );
    return () => {
      generationRef.current++;
      subscription.unsubscribe();
    };
  }, [repository, onError]);

  const onModeChange = (next: WeightRepsPickerMode) => {
    setMode(next);
    if (!repository) return;
    const generation = generationRef.current;
    pendingRef.current++;
    // Rapid taps must persist in selection order, not in promise completion order.
    const write = queueRef.current.catch(() => undefined).then(() => repository.set(next));
    queueRef.current = write;

    const settled = (failed: boolean) => {
      if (generationRef.current !== generation) return;
      pendingRef.current--;
      if (failed) onError('Не удалось сохранить режим пикера. Повторите переключение.');
      if (pendingRef.current !== 0) return;
      // Refresh after the last write; skipped liveQuery updates may have arrived meanwhile.
      void repository.read().then(saved => {
        if (generationRef.current === generation && pendingRef.current === 0) setMode(saved);
      }).catch(() => {
        if (generationRef.current === generation) onError('Не удалось прочитать сохранённый режим пикера.');
      });
    };
    void write.then(() => settled(false), () => settled(true));
  };

  return { mode, ready, onModeChange };
}
