// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CommunicationsNetworkDiagnostic } from './CommunicationsNetworkDiagnostic';
import { probeHosting } from './networkProbe';

vi.mock('./networkProbe', async importOriginal => ({
  ...await importOriginal<typeof import('./networkProbe')>(), probeHosting: vi.fn(),
}));
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.unstubAllGlobals(); });
describe('on-demand device network experiment', () => {
  it('never starts networking on mount and aborts the owned request on unmount', async () => {
    let pendingSignal: AbortSignal | undefined;
    vi.mocked(probeHosting).mockImplementation((_origin, signal) => {
      pendingSignal = signal;
      return new Promise(resolve => signal.addEventListener('abort', () => resolve([]), { once: true }));
    });
    const view = render(<CommunicationsNetworkDiagnostic />);
    expect(probeHosting).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Проверить HTML и JS по сети' }));
    expect(probeHosting).toHaveBeenCalledTimes(1);
    expect((screen.getByRole('button', { name: 'Проверить HTML и JS по сети' }) as HTMLButtonElement).disabled).toBe(true);
    view.unmount();
    expect(pendingSignal?.aborted).toBe(true);
  });
  it('exports only safe observations and explicitly keeps cold start/refresh unproven', async () => {
    vi.mocked(probeHosting).mockResolvedValue([{ step: 'hosting-html', code: 'OK', status: 200, elapsedMs: 7 }]);
    const writeText = vi.fn(async (_text: string) => undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    render(<CommunicationsNetworkDiagnostic />);
    fireEvent.click(screen.getByRole('button', { name: 'Проверить HTML и JS по сети' }));
    await waitFor(() => expect(screen.getByText(/hosting-html: OK/)).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Скопировать безопасный отчёт' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const report = JSON.parse(writeText.mock.calls[0][0]);
    expect(report.coldStart).toBe('not-proven-by-this-panel');
    expect(report.tokenRefresh).toBe('record-separately-with-addon');
    expect(report.backgroundConclusion).toBe('requires-server-and-owner-observation');
    expect(report).not.toHaveProperty('ticket');
    expect(report).not.toHaveProperty('initData');
    expect(report).not.toHaveProperty('file');
  });
});
