// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { KonstaProvider } from 'konsta/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsPage } from './SettingsPage';
import { VoiceMessageModule } from './VoiceMessageModule';

class FakeVoiceMediaRecorder {
  static isTypeSupported = (type: string) => type === 'audio/webm';
  state: RecordingState = 'inactive';
  mimeType = 'audio/webm';
  ondataavailable: ((event: BlobEvent) => void) | null = null;
  onstop: ((event: Event) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  start() { this.state = 'recording'; }
  stop() {
    this.state = 'inactive';
    const event = new Event('dataavailable');
    Object.defineProperty(event, 'data', { value: new Blob(['voice bytes'], { type: 'audio/webm' }) });
    this.ondataavailable?.(event as BlobEvent);
    this.onstop?.(new Event('stop'));
  }
}

const getUserMedia = vi.fn();
const stopTrack = vi.fn();
const createObjectURL = vi.fn(() => 'blob:voice-note-demo');
const revokeObjectURL = vi.fn();
const previousMediaDevices = Object.getOwnPropertyDescriptor(navigator, 'mediaDevices');

beforeEach(() => {
  getUserMedia.mockReset();
  stopTrack.mockReset();
  createObjectURL.mockClear();
  revokeObjectURL.mockClear();
  const track = { readyState: 'live' as MediaStreamTrackState, stop: stopTrack };
  getUserMedia.mockResolvedValue({
    getTracks: () => [track],
    getAudioTracks: () => [track],
  } as unknown as MediaStream);
  vi.stubGlobal('MediaRecorder', FakeVoiceMediaRecorder);
  vi.stubGlobal('AudioContext', undefined);
  vi.stubGlobal('URL', Object.assign(class extends URL {}, { createObjectURL, revokeObjectURL }));
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  });
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  if (previousMediaDevices) Object.defineProperty(navigator, 'mediaDevices', previousMediaDevices);
  else Reflect.deleteProperty(navigator, 'mediaDevices');
});

describe('VoiceMessageModule', () => {
  it('starts recording without visible waveform or timer, then displays the voice bubble player', async () => {
    const view = render(
      <KonstaProvider theme="ios" dark><VoiceMessageModule /></KonstaProvider>,
    );
    expect(getUserMedia).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Записать голосовое' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Завершить запись' })).toBeTruthy());
    expect(screen.queryByRole('slider', { name: 'Перемотка голосового сообщения' })).toBeNull();
    expect(screen.queryByRole('group', { name: 'Голосовое сообщение' })).toBeNull();
    expect(screen.queryByText(/^00:/)).toBeNull();
    expect(getUserMedia).toHaveBeenCalledWith(expect.objectContaining({ video: false }));

    fireEvent.click(screen.getByRole('button', { name: 'Завершить запись' }));
    await waitFor(() => expect(screen.getByRole('group', { name: 'Голосовое сообщение' })).toBeTruthy());
    expect(screen.getByRole('button', { name: 'Воспроизвести голосовое сообщение' })).toBeTruthy();
    expect(screen.getByRole('slider', { name: 'Перемотка голосового сообщения' })).toBeTruthy();
    expect(view.container.querySelector('.voice-note-module__sample')).toBeTruthy();
    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(stopTrack).not.toHaveBeenCalled();
  });

  it('reuses permission for successive recordings and revokes the previous clip URL', async () => {
    const { unmount } = render(
      <KonstaProvider theme="ios" dark><VoiceMessageModule /></KonstaProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Записать голосовое' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Завершить запись' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Завершить запись' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Записать заново' })).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: 'Записать заново' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Завершить запись' })).toBeTruthy());
    expect(getUserMedia).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:voice-note-demo');
    expect(stopTrack).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Завершить запись' }));
    await waitFor(() => expect(screen.getByRole('group', { name: 'Голосовое сообщение' })).toBeTruthy());
    unmount();
    expect(stopTrack).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledTimes(2);
  });

  it('appears in Settings → Modules without requesting the microphone on mount', () => {
    render(<SettingsPage onNavigationContextChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Модули' }));
    const module = screen.getByRole('region', { name: 'Голосовое сообщение' });
    expect(within(module).getByRole('button', { name: 'Записать голосовое' })).toBeTruthy();
    expect(getUserMedia).not.toHaveBeenCalled();
  });
});
