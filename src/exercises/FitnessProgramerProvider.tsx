import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { MezfitCloudDatabase } from '../data/cloud/database';
import {
  FitnessProgramerCatalogueRepository, type FitnessProgramerExercise,
} from '../data/exercises/fitnessProgramerCatalogue';
import { FitnessProgramerMedia } from '../data/exercises/fitnessProgramerMedia';

interface FitnessProgramerState {
  exercises: FitnessProgramerExercise[] | null;
  error: boolean;
  retry?: () => void;
}
const initial: FitnessProgramerState = { exercises: null, error: false };
const catalogueContext = createContext<FitnessProgramerState>(initial);
const mediaContext = createContext<FitnessProgramerMedia | null>(null);

export function FitnessProgramerProvider({ children, db, cloudError }: {
  children: ReactNode;
  db: MezfitCloudDatabase;
  cloudError: boolean;
}) {
  const repository = useMemo(() => db.publicFitnessProgramerExercises
    ? new FitnessProgramerCatalogueRepository(db) : null, [db]);
  const [session, setSession] = useState<{
    repository: FitnessProgramerCatalogueRepository; media: FitnessProgramerMedia; state: FitnessProgramerState;
  } | null>(null);

  useEffect(() => {
    if (!repository) return undefined;
    let active = true;
    const media = new FitnessProgramerMedia(repository);
    setSession({ repository, media, state: initial });
    const catalogue = repository.observe(exercises => {
      if (!active) return;
      setSession({ repository, media, state: { exercises, error: false } });
      if (exercises) media.warm([...new Set(exercises.map(row => row.media_id).filter(Boolean))]);
    }, () => {
      if (active) setSession(previous => previous?.repository === repository
        ? { ...previous, state: { ...previous.state, error: true } } : previous);
    });
    const reconnect = () => media.reconnect();
    const resume = () => { if (document.visibilityState === 'visible') reconnect(); };
    window.addEventListener('online', reconnect);
    document.addEventListener('visibilitychange', resume);
    return () => {
      active = false;
      catalogue.unsubscribe();
      window.removeEventListener('online', reconnect);
      document.removeEventListener('visibilitychange', resume);
      media.close();
    };
  }, [repository]);

  const current = session?.repository === repository ? session : null;
  const state = current?.state ?? initial;
  return <catalogueContext.Provider value={{
    ...state,
    error: state.error || (cloudError && !state.exercises),
    retry: repository ? () => { void db.cloud.sync({ purpose: 'pull', wait: true }).catch(() => {}); } : undefined,
  }}>
    <mediaContext.Provider value={current?.media ?? null}>{children}</mediaContext.Provider>
  </catalogueContext.Provider>;
}

export function useFitnessProgramerCatalogue() {
  return useContext(catalogueContext);
}

export function useLocalFitnessProgramerGif(id: string | null): string | null {
  const media = useContext(mediaContext);
  const [image, setImage] = useState<{ id: string; media: FitnessProgramerMedia; url: string } | null>(null);
  useEffect(() => {
    if (!media || !id || typeof URL.createObjectURL !== 'function') return undefined;
    let url: string | null = null;
    let hasGif = false;
    const unwatch = media.watch(id, (blob, format) => {
      if (hasGif) return;
      const replacement = URL.createObjectURL(blob);
      if (url) URL.revokeObjectURL(url);
      hasGif = format === 'gif';
      url = replacement;
      setImage({ id, media, url: replacement });
    });
    return () => { unwatch(); if (url) URL.revokeObjectURL(url); };
  }, [id, media]);
  return image && image.id === id && image.media === media ? image.url : null;
}
