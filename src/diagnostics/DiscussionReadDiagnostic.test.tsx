// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { summarizeDiscussionReads } from '../data/cloud/discussion-read-diagnostics';
import { DiscussionReadDiagnostic } from './DiscussionReadDiagnostic';

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('device read receipt diagnostic', () => {
  it('copies only the aggregate report', async () => {
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    const report = summarizeDiscussionReads('tg:11', [], [], [], true);
    render(<DiscussionReadDiagnostic report={report} failed={false} />);
    fireEvent.click(screen.getByRole('button', { name: 'Скопировать отчёт о прочтении' }));
    await waitFor(() => expect(screen.getByText('Отчёт скопирован')).toBeTruthy());
    expect(writeText).toHaveBeenCalledWith(JSON.stringify(report, null, 2));
    expect(document.body.textContent).not.toContain('tg:11');
  });

  it('shows clipboard failures without leaking platform errors', async () => {
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn().mockRejectedValue(new Error('secret-platform-error')) } });
    render(<DiscussionReadDiagnostic report={summarizeDiscussionReads('tg:11', [], [], [], true)} failed={false} />);
    fireEvent.click(screen.getByRole('button', { name: 'Скопировать отчёт о прочтении' }));
    await waitFor(() => expect(screen.getByText(/Не удалось скопировать/)).toBeTruthy());
    expect(document.body.textContent).not.toContain('secret-platform-error');
  });

  it('does not allow copying stale evidence after a read failure', () => {
    render(<DiscussionReadDiagnostic report={summarizeDiscussionReads('tg:11', [], [], [], true)} failed />);
    expect(screen.getByRole('alert').textContent).toContain('Не удалось прочитать');
    expect(screen.getByRole('button').hasAttribute('disabled')).toBe(true);
  });
});
