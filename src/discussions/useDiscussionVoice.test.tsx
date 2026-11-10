// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useDiscussionVoice } from './useDiscussionVoice';

class TestPointerEvent extends MouseEvent {
  readonly pointerId = 1;
  readonly isPrimary = true;
}

class TestRecorder {
  static isTypeSupported = (type: string) => type === 'audio/mp4';
  state: RecordingState = 'inactive';
  mimeType = 'audio/mp4';
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;

  start() { this.state = 'recording'; }
  stop() {
    this.state = 'inactive';
    this.ondataavailable?.({ data: new Blob(['clip'], { type: this.mimeType }) });
    this.onstop?.();
  }
}

function fakeMicrophone() {
  const track = { enabled: true, readyState: 'live', stop: vi.fn() };
  const cloneTrack = () => {
    const copy = { ...track, stop: vi.fn() };
    return { getAudioTracks: () => [copy], getTracks: () => [copy] };
  };
  return { track, stream: { getAudioTracks: () => [track], getTracks: () => [track], clone: vi.fn(cloneTrack) } };
}

const getUserMedia = vi.fn();
const mediaDevices = Object.getOwnPropertyDescriptor(navigator, 'mediaDevices');
beforeEach(() => {
  vi.useFakeTimers();
  getUserMedia.mockReset();
  vi.stubGlobal('PointerEvent', TestPointerEvent);
  vi.stubGlobal('MediaRecorder', TestRecorder);
  vi.stubGlobal('AudioContext', undefined);
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } });
});
afterEach(() => {
  cleanup();
  window.dispatchEvent(new Event('pagehide'));
  vi.useRealTimers();
  vi.unstubAllGlobals();
  if (mediaDevices) Object.defineProperty(navigator, 'mediaDevices', mediaDevices);
  else Reflect.deleteProperty(navigator, 'mediaDevices');
});

function Gesture({ onRecorded, onClick, canRecord = true }: {
  onRecorded: Parameters<typeof useDiscussionVoice>[0];
  onClick?: () => void;
  canRecord?: boolean;
}) {
  const voice = useDiscussionVoice(onRecorded);
  return <button type="button" onPointerDown={event => voice.onPointerDown(event, canRecord)}
    onPointerUp={voice.onPointerUp} onPointerCancel={voice.onPointerCancel}
    onClick={() => { if (!voice.consumeClick()) onClick?.(); }}>{voice.status}</button>;
}

it('retains permission after the first gesture ends while the system prompt is open', async () => {
  const mic = fakeMicrophone();
  const onRecorded = vi.fn();
  let grant: ((stream: unknown) => void) | undefined;
  getUserMedia.mockImplementation(() => new Promise(resolve => { grant = resolve; }));
  const first = render(<Gesture onRecorded={onRecorded} />);
  const button = screen.getByRole('button');

  fireEvent.pointerDown(button);
  await act(async () => { await vi.advanceTimersByTimeAsync(280); });
  expect(button.textContent).toBe('requesting');
  fireEvent.pointerUp(button);
  await act(async () => { grant?.(mic.stream); });
  expect(button.textContent).toBe('idle');
  expect(onRecorded).not.toHaveBeenCalled();
  expect(mic.track.enabled).toBe(false);
  first.unmount();

  render(<Gesture onRecorded={onRecorded} />);
  const reopened = screen.getByRole('button');
  fireEvent.pointerDown(reopened);
  await act(async () => { await vi.advanceTimersByTimeAsync(280); });
  expect(reopened.textContent).toBe('recording');
  await act(async () => { fireEvent.pointerUp(reopened); });
  expect(onRecorded).toHaveBeenCalledWith(expect.objectContaining({ mimeType: 'audio/mp4' }));
  expect(getUserMedia).toHaveBeenCalledOnce();
  expect(mic.track.stop).not.toHaveBeenCalled();
  act(() => { window.dispatchEvent(new Event('pagehide')); });
  expect(mic.track.stop).toHaveBeenCalledOnce();
});

it('keeps short tap and the next send click working, and discards a canceled hold', async () => {
  getUserMedia.mockResolvedValue(fakeMicrophone().stream);
  const onClick = vi.fn(), onRecorded = vi.fn();
  const view = render(<Gesture onRecorded={onRecorded} onClick={onClick} />);
  const button = screen.getByRole('button');
  fireEvent.pointerDown(button);
  fireEvent.pointerUp(button);
  fireEvent.click(button);
  expect(onClick).toHaveBeenCalledOnce();
  expect(getUserMedia).not.toHaveBeenCalled();

  fireEvent.pointerDown(button);
  await act(async () => { await vi.advanceTimersByTimeAsync(280); });
  expect(button.textContent).toBe('idle'); // Granting access alone never starts recording.
  fireEvent.pointerUp(button);
  fireEvent.pointerDown(button);
  await act(async () => { await vi.advanceTimersByTimeAsync(280); });
  expect(button.textContent).toBe('recording');
  fireEvent.pointerCancel(button);
  expect(onRecorded).not.toHaveBeenCalled();

  fireEvent.pointerDown(button);
  await act(async () => { await vi.advanceTimersByTimeAsync(280); });
  await act(async () => { fireEvent.pointerUp(button); });
  expect(onRecorded).toHaveBeenCalledOnce();

  view.rerender(<Gesture onRecorded={onRecorded} onClick={onClick} canRecord={false} />);
  fireEvent.pointerDown(button);
  fireEvent.click(button);
  expect(onClick).toHaveBeenCalledTimes(2);
});
