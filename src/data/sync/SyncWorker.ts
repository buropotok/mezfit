import type { SyncEngine } from './SyncEngine';

export interface SyncWorkerOptions {
  intervalMs?: number;
  onError?: (error: unknown) => void;
}

export class SyncWorker {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private started = false;
  private running: Promise<void> | null = null;
  private rerunRequested = false;
  private rerunForce = false;
  private readonly intervalMs: number;
  private readonly onError: (error: unknown) => void;

  constructor(
    private readonly engine: SyncEngine,
    options: SyncWorkerOptions = {},
  ) {
    this.intervalMs = Math.max(1_000, options.intervalMs ?? 15_000);
    this.onError = options.onError ?? (() => undefined);
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
    this.triggerWake();
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
      this.rerunForce = this.rerunForce || Boolean(options.force);
      await this.running;
      return;
    }

    this.clearTimer();
    this.running = (async () => {
      let force = Boolean(options.force);
      do {
        this.rerunRequested = false;
        force = force || this.rerunForce;
        this.rerunForce = false;
        await this.engine.flushAll({ force });
        force = false;
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
    this.triggerWake();
  };

  private readonly onVisibilityChange = () => {
    if (document.visibilityState === 'visible') this.triggerWake();
  };

  private triggerWake(options: { force?: boolean } = {}): void {
    void this.wake(options).catch((error: unknown) => {
      this.onError(error);
    });
  }

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
      this.triggerWake();
    }, this.intervalMs);
  }
}
