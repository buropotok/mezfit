import type { SyncEngine } from './SyncEngine';
import type { SyncFlushOutcome, SyncPullOutcome } from './types';

export interface SyncWorkerOptions {
  intervalMs?: number;
  onError?: (error: unknown) => void;
}

export class SyncWorkerScopeError extends Error {
  constructor(
    readonly scopeKey: string,
    readonly code: string,
  ) {
    super(`SYNC_SCOPE_FAILED:${scopeKey}:${code}`);
    this.name = 'SyncWorkerScopeError';
  }
}

export class SyncWorker {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private started = false;
  private running: Promise<void> | null = null;
  private pendingAutomatic = false;
  private pendingForce = false;
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

  /** Await this promise before disposing the owner's local database. */
  async stop(): Promise<void> {
    if (!this.started) {
      if (this.running) await this.running;
      return;
    }
    this.started = false;
    this.pendingAutomatic = false;
    this.pendingForce = false;
    this.clearTimer();
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', this.onOnline);
    }
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.onVisibilityChange);
    }
    // Inflight network requests cannot be cancelled safely after an ambiguous push.
    // Wait for their persisted outcome before the owner closes its storage.
    if (this.running) await this.running;
  }

  async wake(options: { force?: boolean } = {}): Promise<void> {
    const force = Boolean(options.force);
    if (!this.started && !force) return;

    if (force) this.pendingForce = true;
    else this.pendingAutomatic = true;

    this.clearTimer();
    try {
      await this.drain();
    } finally {
      if (this.started && !this.running && !this.hasPendingPass()) {
        this.scheduleNext();
      }
    }
  }

  private async drain(): Promise<void> {
    while (true) {
      const active = this.running;
      if (active) {
        await active;
        continue;
      }
      if (!this.hasPendingPass()) return;

      const run = this.runPendingPasses();
      this.running = run;
      try {
        await run;
      } finally {
        if (this.running === run) this.running = null;
      }
    }
  }

  private async runPendingPasses(): Promise<void> {
    while (this.hasPendingPass()) {
      const force = this.pendingForce;
      this.pendingForce = false;
      this.pendingAutomatic = false;

      const results = await this.engine.flushAll({ force });
      this.reportScopeFailures(results);
    }
  }

  private hasPendingPass(): boolean {
    return this.pendingForce || (this.started && this.pendingAutomatic);
  }

  private reportScopeFailures(
    results: Map<string, SyncFlushOutcome | SyncPullOutcome>,
  ): void {
    for (const [scopeKey, result] of results) {
      if (result.kind !== 'failed') continue;
      this.reportError(new SyncWorkerScopeError(scopeKey, result.error));
    }
  }

  private reportError(error: unknown): void {
    try {
      this.onError(error);
    } catch {
      // Error reporting must never break synchronization.
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
      this.reportError(error);
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
