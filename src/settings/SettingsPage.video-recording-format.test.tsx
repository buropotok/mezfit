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
  render(<SettingsPage />);
  fireEvent.click(screen.getByRole('button', { name: 'Модули' }));
  const slider = screen.getByRole('slider', { name: /Формат записи/ });
  expect(slider).toHaveProperty('value', '0');
  expect(getVideoRecordingFormatPreference()).toBe('mp4');

  fireEvent.change(slider, { target: { value: '1' } });
  expect(getVideoRecordingFormatPreference()).toBe('webm');
  expect(screen.getByText('Формат записи: WebM (принудительно)')).toBeTruthy();

  fireEvent.change(slider, { target: { value: '0' } });
  expect(getVideoRecordingFormatPreference()).toBe('mp4');
});
