// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SettingsPage } from './SettingsPage';
import { getVideoRecordingFormatPreference } from '../video-note/video-recording-format-preference';

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.stubGlobal('requestAnimationFrame', (_cb: FrameRequestCallback) => 1);
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it('exposes the native MP4-WebM range in Modules and persists forced WebM for recorder', () => {
  render(<SettingsPage onNavigationContextChange={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Модули' }));
  // Query the native Konsta input directly: jsdom's accessible-role CSS walk
  // can throw while parsing complex styles elsewhere in the Modules gallery.
  // Keep the real slider, its label association, and its change handler under test.
  const slider = document.getElementById('video-recording-format-preference');
  expect(slider).toBeInstanceOf(HTMLInputElement);
  if (!(slider instanceof HTMLInputElement)) throw new Error('Native recording format slider is missing');
  expect(slider.type).toBe('range');
  expect(slider.labels?.[0]?.textContent).toContain('Формат записи');
  expect(slider.value).toBe('0');
  expect(getVideoRecordingFormatPreference()).toBe('mp4');

  fireEvent.change(slider, { target: { value: '1' } });
  expect(getVideoRecordingFormatPreference()).toBe('webm');
  expect(screen.getByText('Формат записи: WebM (принудительно)')).toBeTruthy();

  fireEvent.change(slider, { target: { value: '0' } });
  expect(getVideoRecordingFormatPreference()).toBe('mp4');
});
