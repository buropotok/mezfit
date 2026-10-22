// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsPage } from './SettingsPage';

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    disconnect() {}
  });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Settings windowed preview', () => {
  it('toggles a 320px layout window from the diagnostics screen without changing typography', () => {
    const changed = vi.fn();
    function Harness() {
      const [previewWidth, setPreviewWidth] = useState<320 | null>(null);
      return (
        <SettingsPage
          onNavigationContextChange={vi.fn()}
          previewWidth={previewWidth}
          onPreviewWidthChange={(width) => {
            changed(width);
            setPreviewWidth(width);
          }}
        />
      );
    }

    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Открыть диагностику' }));
    fireEvent.click(screen.getByRole('button', { name: 'Включить окно 320px' }));

    expect(changed).toHaveBeenLastCalledWith(320);
    expect(screen.getByText('Активно: окно 320px, масштаб 100%.')).toBeTruthy();
    expect(screen.getByText('Образец Headline')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Выключить режим 320px' }));
    expect(changed).toHaveBeenLastCalledWith(null);
    expect(screen.getByRole('button', { name: 'Включить окно 320px' })).toBeTruthy();
  });
});
