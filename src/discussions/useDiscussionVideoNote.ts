import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { useVideoNoteRecorder, type VideoNoteRecording } from '../video-note/useVideoNoteRecorder';

const HOLD_MS = 280;

/** Chat owns the pointer gesture; the existing video-note engine owns camera and recording. */
export function useDiscussionVideoNote(onRecorded: (clip: VideoNoteRecording) => void) {
  const recorder = useVideoNoteRecorder(onRecorded);
  const [permissionReady, setPermissionReady] = useState(false);
  const gesture = useRef<{ id: number; timer: number; held: boolean; started: boolean } | null>(null);
  const suppressClick = useRef(false);

  const cancel = () => {
    if (gesture.current) {
      window.clearTimeout(gesture.current.timer);
      gesture.current = null;
      suppressClick.current = true;
    }
    recorder.cancel();
  };
  const release = () => {
    cancel();
    recorder.release();
    setPermissionReady(false);
  };

  const releaseRef = useRef(release);
  releaseRef.current = release;

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') releaseRef.current();
    };
    const onPageHide = () => releaseRef.current();
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onPageHide);
      releaseRef.current();
    };
  }, []);
  function onPointerDown(event: PointerEvent<HTMLButtonElement>, canRecord: boolean) {
    if (event.button !== 0 || !event.isPrimary || gesture.current) return;
    suppressClick.current = false;
    if (!canRecord) return;
    const id = event.pointerId;
    try { event.currentTarget.setPointerCapture(id); } catch { /* Pointer already released. */ }
    const current = { id, held: false, started: false, timer: 0 };
    current.timer = window.setTimeout(async () => {
      if (gesture.current !== current) return;
      current.held = true;
      suppressClick.current = true;
      const permissionOnly = !recorder.hasStream('user');
      setPermissionReady(false);
      const started = await recorder.start('user', permissionOnly);
      current.started = started;
      if (recorder.hasStream('user') && permissionOnly) setPermissionReady(true);
      // A late permission grant never restarts a released gesture.
      if (gesture.current !== current && started) recorder.cancel();
    }, HOLD_MS);
    gesture.current = current;
  }

  function onPointerUp(event: PointerEvent<HTMLButtonElement>) {
    const current = gesture.current;
    if (!current || current.id !== event.pointerId) return;
    gesture.current = null;
    window.clearTimeout(current.timer);
    if (current.started) void recorder.stop();
    else if (current.held) recorder.cancel();
  }

  function onPointerCancel(event: PointerEvent<HTMLButtonElement>) {
    if (gesture.current?.id === event.pointerId) cancel();
  }

  return {
    status: recorder.status, error: recorder.error, stream: recorder.stream, progress: recorder.progress,
    permissionReady, cancel, onPointerDown, onPointerUp, onPointerCancel,
    consumeClick: () => {
      const value = suppressClick.current;
      suppressClick.current = false;
      return value;
    },
  };
}
