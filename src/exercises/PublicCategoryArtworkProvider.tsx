import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useCloudConnections } from '../data/cloud/CloudConnectionsProvider';
import {
  PublicCategoryArtworkRepository, isPublicCategoryArtworkRow,
  type PublicCategoryArtworkId, type PublicCategoryArtworkRow,
} from '../data/exercises/publicCategoryArtwork';

type ArtworkUrls = Partial<Record<PublicCategoryArtworkId, string>>;
type CachedArtwork = { version: string; url: string };
const Context = createContext<ArtworkUrls>({});

/**
 * Prepare all eight public images after the authenticated shell mounts.
 * Only local Dexie reads are initiated here; Dexie Cloud Addon handles blob hydration.
 * Cached object URLs survive catalogue page remounts and are released with the account.
 */
export function PublicCategoryArtworkProvider({ children }: { children: ReactNode }) {
  const cloud = useCloudConnections();
  const db = cloud?.db;
  const repository = useMemo(() => db ? new PublicCategoryArtworkRepository(db) : null, [db]);
  const [urls, setUrls] = useState<ArtworkUrls>({});

  useEffect(() => {
    if (!repository || !db) return undefined;
    let alive = true;
    let readRevision = 0;
    const cached = new Map<PublicCategoryArtworkId, CachedArtwork>();

    const install = (rows: PublicCategoryArtworkRow[]) => {
      if (!alive) return;
      const next = new Map<PublicCategoryArtworkId, CachedArtwork>();
      for (const row of rows) {
        if (!row || typeof row.category !== 'string') continue;
        const previous = cached.get(row.category);
        if (!isPublicCategoryArtworkRow(row)) {
          // The Addon can temporarily expose a BlobRef for the same local release.
          if (previous && row.id === 'category-artwork:' + row.category
            && row.version === previous.version) next.set(row.category, previous);
          continue;
        }
        if (previous?.version === row.version) {
          next.set(row.category, previous);
        } else {
          try {
            next.set(row.category, { version: row.version, url: URL.createObjectURL(row.image) });
          } catch {
            // IndexedDB remains authoritative; unavailable presentation falls back to UIkit.
          }
        }
      }
      for (const [category, previous] of cached) {
        if (!next.has(category)) URL.revokeObjectURL(previous.url);
      }
      cached.clear();
      for (const [category, entry] of next) cached.set(category, entry);
      setUrls(Object.fromEntries([...cached].map(([category, entry]) => [category, entry.url])));
    };

    const refresh = () => {
      const revision = ++readRevision;
      void repository.read().then(rows => {
        if (alive && revision === readRevision) install(rows);
      }).catch(() => {
        // Network and local-storage failures never block application startup.
      });
    };

    let subscription: { unsubscribe(): void } | undefined;
    let blobSubscription: { unsubscribe(): void } | undefined;
    const start = () => {
      if (!alive) return;
      subscription = repository.observe(rows => { ++readRevision; install(rows); }, () => undefined);
      blobSubscription = db.cloud.blobProgress?.subscribe({ next: refresh });
    };
    // Work is deferred until after first paint, including Telegram iOS WebViews
    // without requestIdleCallback.
    let timeout: number | undefined;
    let idle: number | undefined;
    if (typeof window.requestIdleCallback === 'function') {
      idle = window.requestIdleCallback(start, { timeout: 4000 });
    } else {
      timeout = window.setTimeout(start, 800);
    }
    return () => {
      alive = false;
      if (idle !== undefined) window.cancelIdleCallback?.(idle);
      if (timeout !== undefined) window.clearTimeout(timeout);
      subscription?.unsubscribe();
      blobSubscription?.unsubscribe();
      for (const entry of cached.values()) URL.revokeObjectURL(entry.url);
    };
  }, [repository, db]);

  return <Context.Provider value={urls}>{children}</Context.Provider>;
}

export function usePublicCategoryArtwork(category: string): string | null {
  const urls = useContext(Context);
  return Object.hasOwn(urls, category) ? urls[category as PublicCategoryArtworkId] ?? null : null;
}
