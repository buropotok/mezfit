// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SettingsPage } from './SettingsPage';
import { VideoRecordingFormatControl } from './VideoRecordingFormatControl';
import { getVideoRecordingFormatPreference } from '../video-note/video-recording-format-preference';

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  });
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it('shows the actual format control in the Settings Modules gallery', () => {
  render(<SettingsPage onNavigationContextChange={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Модули' }));
  const slider = document.getElementById('video-recording-format-preference');
  expect(slider).toBeInstanceOf(HTMLInputElement);
  expect((slider as HTMLInputElement).type).toBe('range');
  expect(screen.getByText('Формат записи: MP4 → WebM (автоматически)')).toBeTruthy();
});

it('uses the native Konsta Range to persist a forced WebM preference and restore automatic MP4', () => {
  // Konsta 5.4.0 Range calculates thumbWidth / trackWidth using offsetWidth.
  // jsdom has no layout (both default to 0), which leads to NaN and
  // calc(NaN%) after value changes. Supply only physical layout dimensions;
  // do not mock, replace or change Konsta's input/event/visual mechanics.
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function (this: HTMLElement) {
    return this.classList.contains('pointer-events-none') ? 20 : 200;
  });
  const view = render(<VideoRecordingFormatControl />);
  const slider = view.container.querySelector<HTMLInputElement>('#video-recording-format-preference');
  expect(slider).toBeInstanceOf(HTMLInputElement);
  if (!slider) throw new Error('Video recording format Range not mounted');
  expect(slider.type).toBe('range');
  expect(slider.labels?.[0]?.textContent).toContain('Формат записи');
  expect(slider.value).toBe('0');
  expect(getVideoRecordingFormatPreference()).toBe('mp4');

  fireEvent.change(slider, { target: { value: '1' } });
  expect(getVideoRecordingFormatPreference()).toBe('webm');
  expect(slider.labels?.[0]?.textContent).toContain('Формат записи: WebM (принудительно)');
  expect(slider.value).toBe('1');

  fireEvent.change(slider, { target: { value: '0' } });
  expect(getVideoRecordingFormatPreference()).toBe('mp4');
  expect(slider.value).toBe('0');
});
