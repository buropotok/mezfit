// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ScreenDiagnostics } from './ScreenDiagnostics';
import { SCREEN_DIAGNOSTICS_DEEP_LINK } from './screenDiagnosticsRoute';

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  Object.defineProperty(window, 'visualViewport', { configurable: true, value: undefined });
});

describe('ScreenDiagnostics', () => {
  it('reports actual WebView and typography measurements, with unsupported values labeled', () => {
    const addEventListener = vi.fn();
    const removeEventListener = vi.fn();
    Object.defineProperty(window, 'visualViewport', {
      configurable: true,
      value: {
        width: 320,
        height: 620,
        scale: 1,
        addEventListener,
        removeEventListener,
      },
    });

    const view = render(<ScreenDiagnostics glassBlur={14} />);

    expect(screen.getByRole('region', { name: 'Диагностика экрана' })).toBeTruthy();
    expect(screen.getByText('VisualViewport: масштаб')).toBeTruthy();
    expect(screen.getByText('devicePixelRatio')).toBeTruthy();
    expect(view.container.querySelector('[aria-label="Контрольные размеры"]')).toBeTruthy();
    expect(screen.getByText('Образец Headline')).toBeTruthy();
    expect(screen.getByText('320 px')).toBeTruthy();
    expect(addEventListener).toHaveBeenCalledWith('resize', expect.any(Function));

    fireEvent.click(screen.getByRole('button', { name: 'Обновить измерения' }));
    expect(screen.getByText('VisualViewport: ширина')).toBeTruthy();

    view.unmount();
    expect(removeEventListener).toHaveBeenCalledWith('resize', expect.any(Function));
  });

  it('copies the Main Mini App diagnostics link for the second phone', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });

    render(<ScreenDiagnostics glassBlur={7} />);
    fireEvent.click(screen.getByRole('button', { name: 'Копировать ссылку' }));

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(SCREEN_DIAGNOSTICS_DEEP_LINK);
    });
    expect(screen.getByRole('status').textContent).toContain('Ссылка скопирована');
  });
});
