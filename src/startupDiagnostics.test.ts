import { describe, expect, it, vi } from 'vitest';

describe('startup diagnostics', () => {
  it('records startup step lifecycle in order', async () => {
    vi.resetModules();
    const diagnostics = await import('./startupDiagnostics');

    await diagnostics.trackStartupStep('Модуль теста', async () => 'ok');

    const entries = diagnostics.getStartupLogSnapshot();
    expect(entries.map((entry) => entry.message)).toEqual([
      'Модуль теста: загрузка',
      'Модуль теста: готово',
    ]);
    expect(diagnostics.formatStartupLogEntry(entries[0])).toContain('Модуль теста: загрузка');
  });

  it('notifies subscribers and records failures', async () => {
    vi.resetModules();
    const diagnostics = await import('./startupDiagnostics');
    let notifications = 0;
    const unsubscribe = diagnostics.subscribeStartupLog(() => {
      notifications += 1;
    });

    await expect(
      diagnostics.trackStartupStep('Сбойный модуль', async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    unsubscribe();

    expect(notifications).toBe(2);
    expect(diagnostics.getStartupLogSnapshot().at(-1)?.message).toBe('Сбойный модуль: ошибка — boom');
    expect(diagnostics.getStartupLogSnapshot().at(-1)?.level).toBe('error');
  });
});
