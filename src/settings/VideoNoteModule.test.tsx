// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsPage } from './SettingsPage';
import { VideoNoteModule } from './VideoNoteModule';

class FakeMediaRecorder {
  static isTypeSupported = (mimeType: string) => mimeType === 'video/webm';
  state: 'inactive' | 'recording' = 'inactive';
  mimeType = 'video/webm';
  onstop: ((event: Event) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  ondataavailable: ((event: BlobEvent) => void) | null = null;

  start() { this.state = 'recording'; }
  stop() {
    this.state = 'inactive';
    this.ondataavailable?.(new BlobEvent('dataavailable', {
      data: new Blob(['video bytes'], { type: 'video/webm' }),
    }));
    this.onstop?.(new Event('stop'));
  }
}

const trackStop = vi.fn();
const getUserMedia = vi.fn();
const createObjectURL = vi.fn(() => 'blob:video-note');
const revokeObjectURL = vi.fn();

function fakeStream(): MediaStream {
  return { getTracks: () => [{ stop: trackStop }] } as unknown as MediaStream;
}

beforeEach(() => {
  trackStop.mockReset();
  getUserMedia.mockReset().mockResolvedValue(fakeStream());
  createObjectURL.mockClear();
  revokeObjectURL.mockClear();
  vi.stubGlobal('MediaRecorder', FakeMediaRecorder);
  vi.stubGlobal('URL', Object.assign(class extends URL {}, { createObjectURL, revokeObjectURL }));
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia },
  });
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: undefined });
});

describe('VideoNoteModule', () => {
  it('requests camera and microphone only on user action, records and revokes the local clip on retake', async () => {
    render(<VideoNoteModule />);
    expect(getUserMedia).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Включить камеру' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Начать запись' })).toBeTruthy());
    expect(getUserMedia).toHaveBeenCalledWith(expect.objectContaining({ audio: expect.any(Object) }));

    fireEvent.click(screen.getByRole('button', { name: 'Начать запись' }));
    expect(screen.getByText(/Запись: .*\/ 60 сек/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Завершить запись' }));
    expect(screen.getByRole('button', { name: 'Воспроизвести' })).toBeTruthy();
    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(trackStop).toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Записать заново' }));
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:video-note');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Начать запись' })).toBeTruthy());
  });

  it('rejects unsupported video APIs without asking for camera access', () => {
    vi.stubGlobal('MediaRecorder', undefined);
    render(<VideoNoteModule />);
    fireEvent.click(screen.getByRole('button', { name: 'Включить камеру' }));
    expect(screen.getByRole('alert').textContent).toMatch(/не поддерживает/);
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it('releases a late camera stream when the module unmounts', async () => {
    let resolveStream: ((stream: MediaStream) => void) | undefined;
    getUserMedia.mockImplementation(() => new Promise<MediaStream>((resolve) => {
      resolveStream = resolve;
    }));
    const { unmount } = render(<VideoNoteModule />);
    fireEvent.click(screen.getByRole('button', { name: 'Включить камеру' }));
    unmount();
    await act(async () => {
      resolveStream?.(fakeStream());
      await Promise.resolve();
    });
    expect(trackStop).toHaveBeenCalledOnce();
  });

  it('exposes the standalone recorder in Settings → Modules without activating the camera', () => {
    render(<SettingsPage onNavigationContextChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Модули' }));
    const module = screen.getByRole('region', { name: 'Видеокружок' });
    expect(within(module).getByRole('button', { name: 'Включить камеру' })).toBeTruthy();
    expect(getUserMedia).not.toHaveBeenCalled();
  });
});
