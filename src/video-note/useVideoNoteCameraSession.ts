import { useCallback, useEffect, useRef } from 'react';

export type VideoNoteFacingMode = 'user' | 'environment';

/**
 * Owns a single camera+microphone session for one mounted video-note recorder.
 * Keep it across takes, but never across recorder unmount/reset or camera switches.
 * This hook is independent of Settings, so a discussion composer can reuse it.
 */
export function useVideoNoteCameraSession() {
  const streamRef = useRef<MediaStream | null>(null);
  const facingRef = useRef<VideoNoteFacingMode | null>(null);
  const requestIdRef = useRef(0);
  const mountedRef = useRef(false);

  const liveStream = useCallback((facing?: VideoNoteFacingMode): MediaStream | null => {
    const stream = streamRef.current;
    if (!stream || (facing && facing !== facingRef.current)) return null;
    const tracks = stream.getTracks();
    // A WebView may revoke a track while the app is backgrounded. Reacquire then.
    if (tracks.length === 0 || tracks.some((track) => track.readyState === 'ended')) return null;
    return stream;
  }, []);

  const release = useCallback(() => {
    requestIdRef.current += 1;
    const stream = streamRef.current;
    streamRef.current = null;
    facingRef.current = null;
    stream?.getTracks().forEach((track) => track.stop());
  }, []);

  const acquire = useCallback(async (facing: VideoNoteFacingMode): Promise<MediaStream | null> => {
    const existing = liveStream(facing);
    if (existing) return existing;

    // When a stream is dead or the camera changes, dispose it before reacquiring.
    release();
    const requestId = ++requestIdRef.current;
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: facing } },
      audio: { echoCancellation: true, noiseSuppression: true },
    });
    if (!mountedRef.current || requestId !== requestIdRef.current) {
      stream.getTracks().forEach((track) => track.stop());
      return null;
    }

    streamRef.current = stream;
    facingRef.current = facing;
    return stream;
  }, [liveStream, release]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      release();
    };
  }, [release]);

  return { acquire, liveStream, release };
}
