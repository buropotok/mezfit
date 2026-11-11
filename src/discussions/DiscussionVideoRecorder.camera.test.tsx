// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { KonstaProvider } from 'konsta/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { VideoNoteFacingMode } from '../video-note/useVideoNoteCameraSession';
import { DiscussionVideoRecorder } from './DiscussionVideoRecorder';

const record = vi.fn<(stream: MediaStream) => void>();
const previousDevices = Object.getOwnPropertyDescriptor(navigator, 'mediaDevices');

class TestRecorder {
  static isTypeSupported() { return true; }
  state: RecordingState = 'inactive';

  constructor(stream: MediaStream) { record(stream); }
  start() { this.state = 'recording'; }
  stop() { this.state = 'inactive'; }
}

function camera(facingMode: VideoNoteFacingMode) {
  const video = { kind: 'video', readyState: 'live', enabled: false, stop: vi.fn(), getSettings: () => ({ facingMode }) };
  return { video, stream: { getTracks: () => [video], getVideoTracks: () => [video] } };
}

function openRecorder() {
  const getUserMedia = vi.fn<(constraints: MediaStreamConstraints) => Promise<unknown>>();
  vi.stubGlobal('MediaRecorder', TestRecorder);
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } });
  return {
    getUserMedia,
    open: () => render(<KonstaProvider theme="ios" dark>
      <DiscussionVideoRecorder onCancel={() => {}} onUse={() => {}} onGallery={() => {}} />
    </KonstaProvider>),
  };
}

afterEach(() => {
  cleanup();
  window.dispatchEvent(new Event('pagehide'));
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  if (previousDevices) Object.defineProperty(navigator, 'mediaDevices', previousDevices);
  else Reflect.deleteProperty(navigator, 'mediaDevices');
});

it('switches the live preview both ways and records from the selected camera', async () => {
  const rear = camera('environment');
  const front = camera('user');
  const rearAgain = camera('environment');
  const frontAgain = camera('user');
  const { open, getUserMedia } = openRecorder();
  getUserMedia.mockResolvedValueOnce(rear.stream).mockResolvedValueOnce(front.stream)
    .mockResolvedValueOnce(rearAgain.stream).mockResolvedValueOnce(frontAgain.stream);
  open();

  const preview = screen.getByLabelText<HTMLVideoElement>('Изображение с камеры');
  await waitFor(() => expect(preview.srcObject).toBe(rear.stream));
  fireEvent.click(screen.getByRole('button', { name: 'Переключить на фронтальную камеру' }));
  await waitFor(() => expect(preview.srcObject).toBe(front.stream));
  expect(rear.video.stop).toHaveBeenCalledOnce();
  expect(getUserMedia).toHaveBeenNthCalledWith(2, expect.objectContaining({
    video: expect.objectContaining({ facingMode: { exact: 'user' } }),
  }));

  fireEvent.click(screen.getByRole('button', { name: 'Переключить на заднюю камеру' }));
  await waitFor(() => expect(preview.srcObject).toBe(rearAgain.stream));
  expect(getUserMedia).toHaveBeenNthCalledWith(3, expect.objectContaining({
    video: expect.objectContaining({ facingMode: { exact: 'environment' } }),
  }));

  fireEvent.click(screen.getByRole('button', { name: 'Переключить на фронтальную камеру' }));
  await waitFor(() => expect(preview.srcObject).toBe(frontAgain.stream));
  const landscape = window.screen.orientation?.type.startsWith('landscape');
  Object.defineProperties(preview, {
    videoWidth: { value: landscape ? 1280 : 720 }, videoHeight: { value: landscape ? 720 : 1280 }, readyState: { value: 2 },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Начать запись' }));
  expect(record).toHaveBeenCalledExactlyOnceWith(frontAgain.stream);
  expect(getUserMedia).toHaveBeenCalledTimes(4);
  expect(screen.queryByRole('button', { name: /Переключить на/ })).toBeNull();
});

it('reports when the WebView returns the wrong camera and lets the user switch back', async () => {
  const rear = camera('environment');
  const wrongCamera = camera('environment');
  const rearAgain = camera('environment');
  const { open, getUserMedia } = openRecorder();
  getUserMedia.mockResolvedValueOnce(rear.stream).mockResolvedValueOnce(wrongCamera.stream).mockResolvedValueOnce(rearAgain.stream);
  open();

  const preview = screen.getByLabelText<HTMLVideoElement>('Изображение с камеры');
  await waitFor(() => expect(preview.srcObject).toBe(rear.stream));
  fireEvent.click(screen.getByRole('button', { name: 'Переключить на фронтальную камеру' }));
  expect((await screen.findByRole('alert')).textContent).toContain('Выбранная камера недоступна');
  expect(preview.srcObject).toBeNull();
  expect(wrongCamera.video.stop).toHaveBeenCalledOnce();

  fireEvent.click(screen.getByRole('button', { name: 'Переключить на заднюю камеру' }));
  await waitFor(() => expect(preview.srcObject).toBe(rearAgain.stream));
});
