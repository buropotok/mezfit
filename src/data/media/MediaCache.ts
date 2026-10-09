export interface ResolvedMedia {
  src: string;
  revoke: boolean;
}

type Fetcher = typeof fetch;

const PUBLIC_CACHE_NAME = 'mezfit-media-public-v1';

function cacheStorageOrNull(): CacheStorage | null {
  return typeof caches === 'undefined' ? null : caches;
}

export class MediaCache {
  constructor(
    private readonly cacheName: string,
    private readonly cacheStorage: CacheStorage | null = cacheStorageOrNull(),
    private readonly fetcher: Fetcher = fetch,
  ) {}

  async resolve(url: string, signal?: AbortSignal): Promise<ResolvedMedia> {
    if (!this.cacheStorage || typeof URL.createObjectURL !== 'function') {
      return { src: url, revoke: false };
    }

    const cache = await this.cacheStorage.open(this.cacheName);
    let response = await cache.match(url);

    if (!response) {
      response = await this.fetcher(url, { signal });
      if (!response.ok) throw new Error(`MEDIA_FETCH_FAILED_${response.status}`);
      await cache.put(url, response.clone());
    }

    const blob = await response.blob();
    return { src: URL.createObjectURL(blob), revoke: true };
  }

  async prefetch(urls: Iterable<string>): Promise<void> {
    if (!this.cacheStorage) return;
    const cache = await this.cacheStorage.open(this.cacheName);
    const uniqueUrls = [...new Set([...urls].filter(Boolean))];

    for (const url of uniqueUrls) {
      if (await cache.match(url)) continue;
      try {
        const response = await this.fetcher(url);
        if (response.ok) await cache.put(url, response.clone());
      } catch {
        // Prefetch is opportunistic. Rendering still has the normal network fallback.
      }
    }
  }

  async remove(url: string): Promise<void> {
    if (!this.cacheStorage) return;
    const cache = await this.cacheStorage.open(this.cacheName);
    await cache.delete(url);
  }
}

export const publicMediaCache = new MediaCache(PUBLIC_CACHE_NAME);

export function accountMediaCache(telegramUserId: string): MediaCache {
  return new MediaCache(`mezfit-media-account-${telegramUserId}-v1`);
}
