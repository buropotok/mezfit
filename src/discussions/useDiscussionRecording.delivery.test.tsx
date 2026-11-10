// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useRef, useState } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useDiscussionVideoNote } from './useDiscussionVideoNote';
import { useDiscussionVoice } from './useDiscussionVoice';
import { PRESS_SCALE_PEAK_TIME } from '../ui/PressScale';
import type { VideoNoteRecording } from '../video-note/useVideoNoteRecorder';

const clip = { blob: new Blob(['take'], { type: 'video/mp4' }), mimeType: 'video/mp4', durationMs: 1000 };
const voiceClip = { ...clip, waveform: [0.2], mimeType: 'audio/mp4' };
vi.mock('../video-note/useVideoNoteRecorder', () => ({
  useVideoNoteRecorder: (onRecorded: (clip: VideoNoteRecording) => void) => {
    const [status, setStatus] = useState('idle');
    const recording = useRef(false);
    return { status, error: '', stream: null, progress: 0, hasStream: () => true,
      start: async () => { recording.current = true; setStatus('recording'); return true; },
      stop: async () => {
        if (!recording.current) return null;
        recording.current = false; setStatus('idle'); onRecorded(clip); return clip;
      },
      cancel: () => { recording.current = false; setStatus('idle'); },
      release: () => { recording.current = false; setStatus('idle'); },
    };
  },
}));
vi.mock('../voice-note/sessionMicrophone', () => ({ hasSessionMicrophone: () => true }));
vi.mock('../voice-note/useVoiceRecorder', () => ({
  useVoiceRecorder: () => {
    const [status, setStatus] = useState('idle');
    const recording = useRef(false);
    return { status, error: '',
      start: async () => { recording.current = true; setStatus('recording'); return true; },
      stop: async () => {
        if (!recording.current) return null;
        recording.current = false; setStatus('idle'); return voiceClip;
      },
      release: () => { recording.current = false; setStatus('idle'); },
    };
  },
}));
class Pointer extends MouseEvent { readonly pointerId = 1; readonly isPrimary = true; }
beforeEach(() => { vi.useFakeTimers(); vi.stubGlobal('PointerEvent', Pointer); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

function Harness({ type, onRecorded }: { type: 'voice' | 'circle'; onRecorded: () => void }) {
  const voice = useDiscussionVoice(onRecorded);
  const circle = useDiscussionVideoNote(onRecorded);
  const capture = type === 'voice' ? voice : circle;
  return <>
    <button aria-label="Запись" onPointerDown={event => capture.onPointerDown(event, true)}
      onPointerMove={capture.onPointerMove} onPointerUp={capture.onPointerUp}>{capture.phase}</button>
    <button onClick={capture.stop}>Стоп</button>
    <button onClick={capture.send}>Отправить</button>
  </>;
}

it.each(['voice', 'circle'] as const)('reviews locked %s after Stop without publishing on release', async type => {
  const onRecorded = vi.fn();
  render(<Harness type={type} onRecorded={onRecorded} />);
  const button = screen.getByLabelText('Запись');
  fireEvent.pointerDown(button, { clientX: 300, clientY: 600 });
  await act(async () => { await vi.advanceTimersByTimeAsync(PRESS_SCALE_PEAK_TIME); });
  fireEvent.pointerMove(button, { clientX: 300, clientY: 490 });
  fireEvent.pointerUp(button);
  expect(onRecorded).not.toHaveBeenCalled();
  await act(async () => { fireEvent.click(screen.getByText('Стоп')); });
  expect(onRecorded).toHaveBeenCalledOnce();
  expect(onRecorded).toHaveBeenCalledWith(...(type === 'circle' ? [clip, true] : [voiceClip]));
});

it.each(['voice', 'circle'] as const)('explicitly sends locked %s', async type => {
  const onRecorded = vi.fn();
  render(<Harness type={type} onRecorded={onRecorded} />);
  const button = screen.getByLabelText('Запись');
  fireEvent.pointerDown(button, { clientX: 300, clientY: 600 });
  await act(async () => { await vi.advanceTimersByTimeAsync(PRESS_SCALE_PEAK_TIME); });
  fireEvent.pointerMove(button, { clientX: 300, clientY: 490 });
  fireEvent.pointerUp(button);
  await act(async () => { fireEvent.click(screen.getByText('Отправить')); });
  expect(onRecorded).toHaveBeenCalledOnce();
  expect(onRecorded).toHaveBeenCalledWith(...(type === 'circle' ? [clip] : [voiceClip, true]));
});
