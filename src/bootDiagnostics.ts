export type BootStage =
  | 'theme-request-start'
  | 'theme-request-success'
  | 'theme-request-http-error'
  | 'theme-request-error'
  | 'theme-request-timeout'
  | 'theme-applied';

export interface BootDetails {
  timeoutMs?: number;
  httpStatus?: number;
  reason?: string;
  errorName?: string;
}

interface BootRuntime {
  mark(stage: string, details?: BootDetails): void;
  report(stage: string, details?: BootDetails): void;
}

function getBootRuntime(): BootRuntime | undefined {
  if (typeof window === 'undefined') return undefined;
  return (window as Window & { __MEZFIT_BOOT__?: BootRuntime }).__MEZFIT_BOOT__;
}

export function errorName(error: unknown): string {
  return error instanceof Error && error.name ? error.name.slice(0, 64) : 'UnknownError';
}

export function markBoot(stage: BootStage, details?: BootDetails): void {
  getBootRuntime()?.mark(stage, details);
}

export function reportBoot(stage: BootStage, details?: BootDetails): void {
  getBootRuntime()?.report(stage, details);
}

export class BootTimeoutError extends Error {
  constructor(
    readonly stage: BootStage,
    readonly timeoutMs: number,
  ) {
    super(`Startup step timed out after ${timeoutMs} ms`);
    this.name = 'BootTimeoutError';
  }
}

export function withBootTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  timeoutStage: BootStage,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reportBoot(timeoutStage, { timeoutMs });
      reject(new BootTimeoutError(timeoutStage, timeoutMs));
    }, timeoutMs);

    promise.then(
      (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
