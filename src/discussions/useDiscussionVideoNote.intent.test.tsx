// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useRef, useState } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useDiscussionVideoNote } from './useDiscussionVideoNote';
import { PRESS_SCALE_PEAK_TIME } from '../ui/PressScale';
import type { VideoNoteRecording } from '../video-note/useVideoNoteRecorder';

const engine = vi.hoisted(() => ({ end: () => {} }));
vi.mock('../video-note/useVideoNoteRecorder', () => ({
  useVideoNoteRecorder: (onRecorded: (clip: VideoNoteRecording) => void) => {
    const [status, setStatus] = useState<'idle' | 'recording'>('idle');
    const recording = useRef(false);
    const latest = useRef(onRecorded); latest.current = onRecorded;
    const end = () => {
      if (!recording.current) return;
      recording.current = false;
      setStatus('idle');
      latest.current({ blob: new Blob(['take'], { type: 'video/mp4' }), mimeType: 'video/mp4', durationMs: 1000 });
    };
    engine.end = end;
    return { status, error: '', stream: null, progress: 0, hasStream: () => true,
      start: async () => { recording.current = true; setStatus('recording'); return true; },
      stop: async () => { end(); return null; },
      cancel: () => { recording.current = false; setStatus('idle'); }, release: () => {},
    };
  },
}));
class Pointer extends MouseEvent { readonly pointerId = 1; readonly isPrimary = true; }
beforeEach(() => { vi.useFakeTimers(); vi.stubGlobal('PointerEvent', Pointer); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

function Harness({ complete }: { complete: (clip: VideoNoteRecording, preview?: boolean) => void }) {
  const circle = useDiscussionVideoNote(complete);
  return <>
    <button aria-label="Запись" onPointerDown={event => circle.onPointerDown(event, true)}
      onPointerMove={circle.onPointerMove} onPointerUp={circle.onPointerUp}>{circle.phase}</button>
    <button onClick={circle.stop}>Стоп</button>
    <button onClick={circle.send}>Отправить</button>
  </>;
}
async function start() {
  fireEvent.pointerDown(screen.getByLabelText('Запись'), { clientX: 300, clientY: 600 });
  await act(async () => { await vi.advanceTimersByTimeAsync(PRESS_SCALE_PEAK_TIME); });
}

it('treats recorder deadline completion as review even without a lock', async () => {
  const complete = vi.fn();
  render(<Harness complete={complete} />);
  await start();
  act(() => engine.end());
  expect(complete).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ mimeType: 'video/mp4' }), true);
  fireEvent.pointerUp(screen.getByLabelText('Запись'));
  expect(complete).toHaveBeenCalledOnce();
});

it('Stop enters review and subsequent completion signals cannot authorize sending', async () => {
  const complete = vi.fn();
  render(<Harness complete={complete} />);
  await start();
  fireEvent.pointerMove(screen.getByLabelText('Запись'), { clientX: 300, clientY: 490 });
  await act(async () => { fireEvent.click(screen.getByText('Стоп')); });
  expect(complete).toHaveBeenCalledExactlyOnceWith(expect.any(Object), true);
  act(() => engine.end());
  expect(complete).toHaveBeenCalledOnce();
});
