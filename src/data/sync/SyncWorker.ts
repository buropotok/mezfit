import type { SyncEngine } from './SyncEngine';

export interface SyncWorkerOptions {
  intervalMs?: number;
}

export class SyncWorker {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private started = false;
  private running: Promise<void> | null = null;
  private rerunRequested = false;
  private readonly intervalMs: number;

  constructor(
    private readonly engine: SyncEngine,
    options: SyncWorkerOptions = {},
  ) {
    this.intervalMs = Math.max(1_000, options.intervalMs ?? 15_000);
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    if (typeof window !== 'undefined') {
      window.addEventListener('online', this.onOnline);
    }
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.onVisibilityChange);
    }
    void this.wake();
  }

  stop(): void {
    if (!this.started) return;
    this.started = false;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', this.onOnline);
    }
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.onVisibilityChange);
    }
  }

  async wake(options: { force?: boolean } = {}): Promise<void> {
    if (!this.started && !options.force) return;
    if (this.running) {
      this.rerunRequested = true;
      await this.running;
      return;
    }

    this.clearTimer();
    this.running = (async () => {
      do {
        this.rerunRequested = false;
        await this.engine.flushAll({ force: options.force });
      } while (this.rerunRequested);
    })();

    try {
      await this.running;
    } finally {
      this.running = null;
      this.scheduleNext();
    }
  }

  private readonly onOnline = () => {
    void this.wake();
  };

  private readonly onVisibilityChange = () => {
    if (document.visibilityState === 'visible') void this.wake();
  };

  private clearTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private scheduleNext(): void {
    if (!this.started) return;
    this.clearTimer();
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.wake();
    }, this.intervalMs);
  }
}
