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
    const dataEvent = new Event('dataavailable');
    Object.defineProperty(dataEvent, 'data', {
      value: new Blob(['video bytes'], { type: 'video/webm' }),
    });
    this.ondataavailable?.(dataEvent as BlobEvent);
    this.onstop?.(new Event('stop'));
  }
}

const trackStop = vi.fn();
const getUserMedia = vi.fn();
const createObjectURL = vi.fn(() => 'blob:video-note');
const revokeObjectURL = vi.fn();
const mediaDevicesDescriptor = Object.getOwnPropertyDescriptor(navigator, 'mediaDevices');

function fakeStream(): MediaStream {
  return { getTracks: () => [{ stop: trackStop }] } as unknown as MediaStream;
}

beforeEach(() => {
  trackStop.mockReset();
  getUserMedia.mockReset().mockResolvedValue(fakeStream());
  createObjectURL.mockClear();
  revokeObjectURL.mockClear();
  vi.stubGlobal('MediaRecorder', FakeMediaRecorder);
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    disconnect() {}
  });
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  });
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
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
  if (mediaDevicesDescriptor) Object.defineProperty(navigator, 'mediaDevices', mediaDevicesDescriptor);
  else Reflect.deleteProperty(navigator, 'mediaDevices');
});

describe('VideoNoteModule', () => {
  it('starts recording with one tap, reuses permission for retakes and stops only on reset', async () => {
    render(<VideoNoteModule />);
    expect(getUserMedia).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Записать кружок' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Завершить запись' })).toBeTruthy());
    expect(getUserMedia).toHaveBeenCalledWith(expect.objectContaining({ audio: expect.any(Object) }));

    expect(screen.getByText(/Запись: .*\/ 60 сек/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Завершить запись' }));
    expect(screen.getByRole('button', { name: 'Открыть видеокружок' })).toBeTruthy();
    expect(createObjectURL).toHaveBeenCalledOnce();
    // The old requirement to stop tracks after every clip is intentionally retired:
    // reusing the same live MediaStream avoids re-requesting Telegram permissions.
    expect(trackStop).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Записать заново' }));
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:video-note');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Завершить запись' })).toBeTruthy());
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(trackStop).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Завершить запись' }));
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(trackStop).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Сбросить' }));
    expect(trackStop).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: 'Записать кружок' })).toBeTruthy();
  });

  it('switching cameras releases the old stream and acquires the requested facing mode', async () => {
    render(<VideoNoteModule />);
    fireEvent.click(screen.getByRole('button', { name: 'Записать кружок' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Завершить запись' })).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: 'Завершить запись' }));
    expect(screen.getByRole('button', { name: 'Открыть видеокружок' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Сменить камеру' }));
    fireEvent.click(screen.getByRole('button', { name: 'Записать заново' }));
    await waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(2));
    expect(trackStop).toHaveBeenCalledOnce();
    expect(getUserMedia).toHaveBeenLastCalledWith(expect.objectContaining({
      video: { facingMode: { ideal: 'environment' } },
    }));
  });

  it('releases the retained camera and recorded clip on unmount during review', async () => {
    const { unmount } = render(<VideoNoteModule />);
    fireEvent.click(screen.getByRole('button', { name: 'Записать кружок' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Завершить запись' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Завершить запись' }));
    expect(trackStop).not.toHaveBeenCalled();

    unmount();
    expect(trackStop).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:video-note');
  });

  it('rejects unsupported video APIs without asking for camera access', () => {
    vi.stubGlobal('MediaRecorder', undefined);
    render(<VideoNoteModule />);
    fireEvent.click(screen.getByRole('button', { name: 'Записать кружок' }));
    expect(screen.getByRole('alert').textContent).toMatch(/не поддерживает/);
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it('releases a late camera stream when the module unmounts', async () => {
    let resolveStream: ((stream: MediaStream) => void) | undefined;
    getUserMedia.mockImplementation(() => new Promise<MediaStream>((resolve) => {
      resolveStream = resolve;
    }));
    const { unmount } = render(<VideoNoteModule />);
    fireEvent.click(screen.getByRole('button', { name: 'Записать кружок' }));
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
    expect(within(module).getByRole('button', { name: 'Записать кружок' })).toBeTruthy();
    expect(getUserMedia).not.toHaveBeenCalled();
  });
});
