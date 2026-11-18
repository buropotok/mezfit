import Dexie, { type Table } from 'dexie';
import { isFitnessProgramerGifId } from '../../../shared/fitnessprogramer-id';
import type { FitnessProgramerCatalogueRepository } from './fitnessProgramerCatalogue';

type Format = 'gif' | 'webp';
type Job = { id: string; format: Format };
type Show = (blob: Blob, format: Format) => void;
const jobKey = ({ id, format }: Job) => id.slice('fitnessprogramer:gif:'.length) + '.' + format;
const YANDEX = 'https://storage.yandexcloud.net/mezfit-comm-poc-20261106/exercises/base2/v1/';
const R2 = '/api/exercise-media/base2/v1/';

class PublicMediaCache extends Dexie {
  images!: Table<{ key: string; blob: Blob }, string>;

  constructor() {
    super('mezfit-base2-public-media-v1');
    this.version(1).stores({ images: 'key' });
  }
}

export async function fetchFitnessProgramerMedia(job: Job, signal: AbortSignal): Promise<Blob | null> {
  if (!isFitnessProgramerGifId(job.id)) return null;
  const key = jobKey(job);
  for (const base of [YANDEX, R2]) {
    if (signal.aborted) return null;
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal.addEventListener('abort', abort, { once: true });
    const timeout = setTimeout(abort, 8000);
    try {
      const response = await fetch(base + key, { signal: controller.signal, credentials: 'omit', cache: 'force-cache' });
      if (!response.ok) continue;
      const blob = await response.blob();
      if (blob.type !== 'image/' + job.format || blob.size < 12 || blob.size > 2 * 1024 * 1024) continue;
      const bytes = await blob.arrayBuffer();
      if (job.format === 'webp') {
        const header = String.fromCharCode(...new Uint8Array(bytes, 0, 12));
        if (header.startsWith('RIFF') && header.endsWith('WEBP')) return blob;
      } else {
        const sha = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
        const hex = Array.from(sha, byte => byte.toString(16).padStart(2, '0')).join('');
        if (job.id === 'fitnessprogramer:gif:' + hex) return blob;
      }
    } catch {
      // CORS, an unreachable mirror or a stalled body try the other storage provider.
    } finally {
      clearTimeout(timeout);
      signal.removeEventListener('abort', abort);
    }
  }
  return null;
}

/** One bounded queue covers catalogue warm-up and media displayed by mounted rows. */
export class FitnessProgramerMedia {
  private readonly cache = new PublicMediaCache();
  private readonly lifetime = new AbortController();
  private readonly visible = new Map<string, Set<Show>>();
  private readonly urgent = new Map<string, Job>();
  private readonly background = new Map<string, Job>();
  private readonly active = new Set<string>();
  private readonly ready = new Set<string>();
  private readonly legacy = new Set<string>();
  private catalogue: readonly string[] = [];
  private readonly failed = new Map<string, Job>();
  private consecutiveFailures = 0;
  private retryDelay = 5_000;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly initialized: Promise<void>;

  constructor(private readonly repository: Pick<FitnessProgramerCatalogueRepository, 'availableGifIds' | 'readLocalGif'>) {
    this.initialized = Promise.all([
      this.cache.images.toCollection().primaryKeys().then(keys => { for (const key of keys) this.ready.add(key); }),
      repository.availableGifIds().then(ids => { for (const id of ids) this.legacy.add(id); }),
    ].map(task => task.catch(() => undefined))).then(() => undefined);
  }

  warm(ids: readonly string[]) {
    this.catalogue = ids;
    void this.initialized.then(() => {
      if (this.lifetime.signal.aborted) return;
      for (const format of ['webp', 'gif'] as const) {
        for (const id of ids) {
          if (!isFitnessProgramerGifId(id) || this.hasGif(id)) continue;
          const job = { id, format };
          const key = jobKey(job);
          if (!this.ready.has(key) && !this.active.has(key) && !this.urgent.has(key)) this.background.set(key, job);
        }
      }
      this.pump();
    });
  }

  reconnect() {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.consecutiveFailures = 0;
    this.requeueFailures();
    for (const id of this.visible.keys()) this.requestVisible(id);
    this.warm(this.catalogue);
  }

  watch(id: string, show: Show) {
    if (!isFitnessProgramerGifId(id)) return () => {};
    const listeners = this.visible.get(id) ?? new Set<Show>();
    listeners.add(show);
    this.visible.set(id, listeners);
    // Already local bytes should appear even if all network requests are stalled.
    void this.initialized.then(async () => {
      for (const format of ['gif', 'webp'] as const) {
        if (!listeners.has(show) || this.lifetime.signal.aborted) return;
        const job = { id, format };
        if (!(format === 'gif' && this.legacy.has(id)) && !this.ready.has(jobKey(job))) continue;
        const blob = await this.cached(job);
        if (blob && listeners.has(show) && !this.lifetime.signal.aborted) {
          show(blob, format);
          if (format === 'gif') return;
        }
      }
      if (listeners.has(show) && !this.lifetime.signal.aborted) this.requestVisible(id);
    }).catch(() => undefined);
    return () => {
      listeners.delete(show);
      if (!listeners.size) {
        this.visible.delete(id);
        // Scrolling should not leave obsolete requests ahead of newly visible images.
        for (const format of ['webp', 'gif'] as const) {
          const key = jobKey({ id, format });
          const job = this.urgent.get(key);
          if (job) { this.urgent.delete(key); this.background.set(key, job); }
        }
      }
    };
  }

  private hasGif(id: string) {
    return this.legacy.has(id) || this.ready.has(jobKey({ id, format: 'gif' }));
  }

  private requestVisible(id: string) {
    const formats: Format[] = this.hasGif(id) ? ['gif'] : ['webp', 'gif'];
    for (const format of formats) {
      const job = { id, format };
      const key = jobKey(job);
      if (this.ready.has(key) || (format === 'gif' && this.legacy.has(id))) continue;
      this.background.delete(key);
      if (!this.active.has(key)) this.urgent.set(key, job);
    }
    this.pump();
  }

  private pump() {
    if (this.consecutiveFailures >= 4) return;
    while (this.active.size < 4 && !this.lifetime.signal.aborted) {
      const next = this.urgent.values().next().value ?? this.background.values().next().value;
      if (!next) break;
      const key = jobKey(next);
      this.urgent.delete(key);
      this.background.delete(key);
      this.active.add(key);
      void this.load(next).catch(() => undefined).finally(() => {
        this.active.delete(key);
        this.pump();
      });
    }
  }

  private async cached(job: Job): Promise<Blob | null> {
    if (job.format === 'gif' && this.legacy.has(job.id)) {
      const legacy = await this.repository.readLocalGif(job.id).catch(() => null);
      if (legacy) return legacy;
      this.legacy.delete(job.id);
    }
    const key = jobKey(job);
    const record = await this.cache.images.get(key).catch(() => undefined);
    if (!record) this.ready.delete(key);
    return record?.blob ?? null;
  }

  private async load(job: Job) {
    const key = jobKey(job);
    const signal = this.lifetime.signal;
    let blob = await this.cached(job);
    if (!blob && !signal.aborted) {
      blob = await fetchFitnessProgramerMedia(job, signal);
      if (blob && !signal.aborted) {
        try { await this.cache.images.put({ key, blob }); this.ready.add(key); } catch { /* Show even if storage is full. */ }
      }
    }
    if (signal.aborted) return;
    if (!blob) {
      this.consecutiveFailures++;
      this.failed.set(key, job);
      this.scheduleRetry();
      return;
    }
    this.failed.delete(key);
    this.consecutiveFailures = 0;
    this.retryDelay = 5_000;
    for (const show of this.visible.get(job.id) ?? []) show(blob, job.format);
  }

  private requeueFailures() {
    for (const [key, job] of this.failed) {
      const queue = this.visible.has(job.id) ? this.urgent : this.background;
      if (!this.active.has(key)) queue.set(key, job);
    }
    this.failed.clear();
  }

  private scheduleRetry() {
    if (this.timer !== null) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.retryDelay = Math.min(this.retryDelay * 2, 60_000);
      this.consecutiveFailures = 0;
      this.requeueFailures();
      this.pump();
    }, this.retryDelay);
  }

  close() {
    this.lifetime.abort();
    if (this.timer !== null) clearTimeout(this.timer);
    this.visible.clear();
    this.urgent.clear();
    this.background.clear();
    this.cache.close();
  }
}
