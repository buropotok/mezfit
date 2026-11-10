import { useCallback, useEffect, useRef, useState, type PointerEvent } from 'react';
import { hasSessionMicrophone } from '../voice-note/sessionMicrophone';
import { useVoiceRecorder, type VoiceRecording } from '../voice-note/useVoiceRecorder';

const holdMs = 280;

export function useDiscussionVoice(onRecorded: (clip: VoiceRecording) => void) {
  const [permissionReady, setPermissionReady] = useState(false);
  const [levels, setLevels] = useState<number[]>([]);
  const { start, stop, release, status, error } = useVoiceRecorder({
    session: true,
    onSample: level => setLevels(previous => [...previous.slice(-41), Math.min(1, level * 5)]),
  });
  const gesture = useRef<{ id: number; timer: number; held: boolean; started: boolean } | null>(null);
  const suppressClick = useRef(false);
  const generation = useRef(0);
  const latest = useRef(onRecorded);
  latest.current = onRecorded;

  const cancel = useCallback(() => {
    generation.current += 1;
    if (gesture.current) {
      window.clearTimeout(gesture.current.timer);
      suppressClick.current = true;
      gesture.current = null;
    }
    release();
  }, [release]);

  useEffect(() => {
    const onVisibility = () => { if (document.visibilityState === 'hidden') cancel(); };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', cancel);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', cancel);
      cancel();
    };
  }, [cancel]);

  function onPointerDown(event: PointerEvent<HTMLButtonElement>, canRecord: boolean) {
    if (event.button !== 0 || !event.isPrimary || gesture.current) return;
    suppressClick.current = false;
    if (!canRecord) return;
    const id = event.pointerId;
    try { event.currentTarget.setPointerCapture(id); } catch { /* Pointer may already be inactive. */ }
    const current = { id, held: false, started: false, timer: window.setTimeout(async () => {
      if (gesture.current !== current) return;
      current.held = true;
      suppressClick.current = true;
      setLevels([]);
      const permissionOnly = !hasSessionMicrophone();
      setPermissionReady(false);
      const started = await start(permissionOnly);
      if (gesture.current === current) {
        current.started = started;
        if (permissionOnly && hasSessionMicrophone()) setPermissionReady(true);
      }
    }, holdMs) };
    gesture.current = current;
  }

  function onPointerUp(event: PointerEvent<HTMLButtonElement>) {
    const current = gesture.current;
    if (!current || current.id !== event.pointerId) return;
    gesture.current = null;
    window.clearTimeout(current.timer);
    if (current.started) {
      const recordingGeneration = generation.current;
      void stop().then(clip => {
        if (clip && generation.current === recordingGeneration) latest.current(clip);
      });
    } else if (current.held) release();
  }

  function onPointerCancel(event: PointerEvent<HTMLButtonElement>) {
    if (gesture.current?.id === event.pointerId) cancel();
  }

  return { status, permissionReady, error: status === 'error' ? error : '', levels, cancel,
    onPointerDown, onPointerUp, onPointerCancel,
    consumeClick: () => {
      const consumed = suppressClick.current;
      suppressClick.current = false;
      return consumed;
    },
  };
}
