// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useDiscussionVideoNote } from './useDiscussionVideoNote';

class Pointer extends MouseEvent {
  readonly pointerId = 1;
  readonly isPrimary = true;
}
class Recorder {
  static isTypeSupported = (type: string) => type === 'video/webm';
  state: RecordingState = 'inactive';
  mimeType = 'video/webm';
  ondataavailable: ((event: BlobEvent) => void) | null = null;
  onstop: ((event: Event) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  start() { this.state = 'recording'; }
  stop() {
    this.state = 'inactive';
    this.ondataavailable?.({ data: new Blob(['recorded'], { type: this.mimeType }) } as BlobEvent);
    this.onstop?.(new Event('stop'));
  }
}

const getUserMedia = vi.fn();
const descriptor = Object.getOwnPropertyDescriptor(navigator, 'mediaDevices');
function fakeStream() {
  let state: MediaStreamTrackState = 'live';
  const stop = vi.fn(() => { state = 'ended'; });
  const track = { stop, get readyState() { return state; } };
  return { stream: { getTracks: () => [track] } as unknown as MediaStream, stop };
}
beforeEach(() => {
  vi.useFakeTimers();
  getUserMedia.mockReset();
  vi.stubGlobal('PointerEvent', Pointer);
  vi.stubGlobal('MediaRecorder', Recorder);
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } });
});
afterEach(() => {
  cleanup();
  window.dispatchEvent(new Event('pagehide'));
  vi.useRealTimers();
  vi.unstubAllGlobals();
  if (descriptor) Object.defineProperty(navigator, 'mediaDevices', descriptor);
  else Reflect.deleteProperty(navigator, 'mediaDevices');
});

function Gesture({ onRecorded, onClick }: {
  onRecorded: Parameters<typeof useDiscussionVideoNote>[0];
  onClick?: () => void;
}) {
  const video = useDiscussionVideoNote(onRecorded);
  return <button type="button" onPointerDown={event => video.onPointerDown(event, true)}
    onPointerUp={video.onPointerUp} onPointerCancel={video.onPointerCancel}
    onClick={() => { if (!video.consumeClick()) onClick?.(); }}>{video.status}</button>;
}

it('short tap switches mode, long press first grants permission, next hold records and sends on release', async () => {
  const stream = fakeStream();
  let grant: ((value: MediaStream) => void) | undefined;
  getUserMedia.mockImplementation(() => new Promise<MediaStream>(resolve => { grant = resolve; }));
  const onRecorded = vi.fn(), onClick = vi.fn();
  render(<Gesture onRecorded={onRecorded} onClick={onClick} />);
  const button = screen.getByRole('button');
  fireEvent.pointerDown(button); fireEvent.pointerUp(button); fireEvent.click(button);
  expect(onClick).toHaveBeenCalledOnce();
  expect(getUserMedia).not.toHaveBeenCalled();

  fireEvent.pointerDown(button);
  await act(async () => { await vi.advanceTimersByTimeAsync(280); });
  expect(button.textContent).toBe('requesting');
  fireEvent.pointerUp(button);
  await act(async () => { grant?.(stream.stream); });
  expect(onRecorded).not.toHaveBeenCalled();

  fireEvent.pointerDown(button);
  await act(async () => { await vi.advanceTimersByTimeAsync(280); });
  expect(button.textContent).toBe('recording');
  await act(async () => { fireEvent.pointerUp(button); });
  fireEvent.click(button);
  expect(onRecorded).toHaveBeenCalledOnce();
  expect(getUserMedia).toHaveBeenCalledOnce();
  expect(onClick).toHaveBeenCalledOnce();
  expect(onRecorded).toHaveBeenCalledWith(expect.objectContaining({ mimeType: 'video/webm' }));
  act(() => window.dispatchEvent(new Event('pagehide')));
  expect(stream.stop).toHaveBeenCalledOnce();
});

it('pointer cancellation never sends the partially recorded circle', async () => {
  const capture = fakeStream();
  getUserMedia.mockResolvedValue(capture.stream);
  const onRecorded = vi.fn();
  render(<Gesture onRecorded={onRecorded} />);
  const button = screen.getByRole('button');
  fireEvent.pointerDown(button);
  await act(async () => { await vi.advanceTimersByTimeAsync(280); });
  fireEvent.pointerUp(button); // First gesture only establishes permission.

  fireEvent.pointerDown(button);
  await act(async () => { await vi.advanceTimersByTimeAsync(280); });
  expect(button.textContent).toBe('recording');
  act(() => { fireEvent.pointerCancel(button); });
  expect(button.textContent).toBe('idle');
  expect(onRecorded).not.toHaveBeenCalled();
});
