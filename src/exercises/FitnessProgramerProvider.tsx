import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useCloudConnections } from '../data/cloud/CloudConnectionsProvider';
import {
  FitnessProgramerCatalogueRepository, type FitnessProgramerExercise,
} from '../data/exercises/fitnessProgramerCatalogue';

interface FitnessProgramerState {
  exercises: FitnessProgramerExercise[] | null;
  downloaded: number;
  total: number;
  downloading: boolean;
  retry?: () => void;
  error: boolean;
  readyGifIds: ReadonlySet<string>;
}
const initial: FitnessProgramerState = {
  exercises: null, downloaded: 0, total: 0, downloading: false, error: false, readyGifIds: new Set(),
};
const context = createContext<{ state: FitnessProgramerState; repository: FitnessProgramerCatalogueRepository | null }>({
  state: initial, repository: null,
});

/** The Dexie Addon owns eager background downloads on open/sync and their offline persistence. */
export function FitnessProgramerProvider({ children }: { children: ReactNode }) {
  const cloud = useCloudConnections();
  const db = cloud?.db;
  const repository = useMemo(() => db?.publicFitnessProgramerGifs
    ? new FitnessProgramerCatalogueRepository(db) : null, [db]);
  const [state, setState] = useState<{ repository: FitnessProgramerCatalogueRepository; value: FitnessProgramerState } | null>(null);

  useEffect(() => {
    if (!db || !repository) return undefined;
    let active = true;
    let catalogueFailed = false;
    let exercises: FitnessProgramerExercise[] | null = null;
    let downloading = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let revision = 0;
    const refresh = () => {
      ++revision;
      if (timer !== null) return;
      timer = setTimeout(() => {
        timer = null;
        const current = revision;
        void repository.availableGifIds().then(readyGifIds => {
          if (!active || current !== revision) return;
          const ids = new Set(exercises?.map(row => row.media_id).filter(Boolean));
          const downloaded = [...ids].filter(id => readyGifIds.has(id)).length;
          setState({ repository, value: { exercises, downloaded, total: ids.size,
            downloading, error: catalogueFailed, readyGifIds } });
        }, () => {
          if (active && current === revision) setState({ repository, value: { ...initial, exercises, error: true } });
        });
      }, 200);
    };
    const catalogue = repository.observe(rows => { exercises = rows; catalogueFailed = false; refresh(); }, () => {
      catalogueFailed = true;
      refresh();
    });
    const progress = db.cloud.blobProgress?.subscribe({
      next: status => { downloading = status.isDownloading; refresh(); },
      error: () => { downloading = false; refresh(); },
    });
    return () => {
      active = false;
      if (timer !== null) clearTimeout(timer);
      catalogue.unsubscribe();
      progress?.unsubscribe();
    };
  }, [db, repository]);

  const value = state && state.repository === repository ? state.value : initial;
  return <context.Provider value={{ repository, state: {
    ...value,
    error: value.error || (cloud?.status === 'error' && (!value.exercises || value.downloaded < value.total)),
    retry: db ? () => { void db.cloud.sync({ purpose: 'pull', wait: true }).catch(() => {}); } : undefined,
  } }}>
    {children}
  </context.Provider>;
}

export function useFitnessProgramerCatalogue() {
  return useContext(context).state;
}

export function useLocalFitnessProgramerGif(id: string | null): string | null {
  const { state, repository } = useContext(context);
  const ready = id !== null && state.readyGifIds.has(id);
  const [image, setImage] = useState<{ id: string; repository: FitnessProgramerCatalogueRepository; url: string } | null>(null);
  useEffect(() => {
    if (!repository || !id || !ready || typeof URL.createObjectURL !== 'function') return undefined;
    let active = true;
    let url: string | undefined;
    void repository.readLocalGif(id).then(blob => {
      if (!active || !blob) return;
      url = URL.createObjectURL(blob);
      setImage({ id, repository, url });
    }).catch(() => { /* The shared image component uses its normal fallback. */ });
    return () => { active = false; if (url) URL.revokeObjectURL(url); };
  }, [id, ready, repository]);
  return ready && image?.id === id && image.repository === repository ? image.url : null;
}
