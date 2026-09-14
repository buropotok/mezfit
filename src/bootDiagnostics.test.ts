import { afterEach, describe, expect, it, vi } from 'vitest';
import { BootTimeoutError, withBootTimeout } from './bootDiagnostics';

afterEach(() => {
  vi.useRealTimers();
});

describe('withBootTimeout', () => {
  it('returns the startup result when it resolves in time', async () => {
    await expect(withBootTimeout(Promise.resolve('ready'), 1000, 'theme-request-timeout')).resolves.toBe('ready');
  });

  it('rejects a startup step that never settles', async () => {
    vi.useFakeTimers();
    const pending = withBootTimeout(new Promise<never>(() => undefined), 5000, 'theme-request-timeout');
    const expectation = expect(pending).rejects.toBeInstanceOf(BootTimeoutError);

    await vi.advanceTimersByTimeAsync(5000);
    await expectation;
  });
});
