import { useCallback, useEffect, useRef } from 'react';

import { acquireSessionCamera, hasCameraSessionAccess, hasSessionCamera, matchesCameraFacing, ownsSessionCamera, parkSessionCamera } from './sessionCamera';
import { videoRecordingConstraints, type VideoRecordingProfile } from './video-recording-profile';

export type VideoNoteFacingMode = 'user' | 'environment';

/**
 * Owns a single camera+microphone session for one mounted video-note recorder.
 * Shared product recorders park the source across navigation within Mezfit.
 * This hook is independent of Settings, so a discussion composer can reuse it.
 */
export function useVideoNoteCameraSession(profile: VideoRecordingProfile = 'circle', session = false) {
  const token = useRef(Symbol('camera lease'));
  const streamRef = useRef<MediaStream | null>(null);
  const facingRef = useRef<VideoNoteFacingMode | null>(null);
  const requestIdRef = useRef(0);
  const mountedRef = useRef(false);

  const liveStream = useCallback((facing?: VideoNoteFacingMode, requireFacing = false): MediaStream | null => {
    const stream = streamRef.current;
    if (session && !ownsSessionCamera(token.current)) return null;
    if (!stream || (facing && (facing !== facingRef.current || (requireFacing && !matchesCameraFacing(stream, facing))))) return null;
    const tracks = stream.getTracks();
    // A WebView may revoke a track while the app is backgrounded. Reacquire then.
    if (tracks.length === 0 || tracks.some((track) => track.readyState === 'ended')) return null;
    return stream;
  }, [session]);

  const release = useCallback(() => {
    requestIdRef.current += 1;
    const stream = streamRef.current;
    streamRef.current = null;
    facingRef.current = null;
    if (session) parkSessionCamera(token.current);
    else stream?.getTracks().forEach((track) => track.stop());
  }, [session]);

  const acquire = useCallback(async (facing: VideoNoteFacingMode, requireFacing = false): Promise<MediaStream | null> => {
    const existing = liveStream(facing, requireFacing);
    if (existing) return existing;

    // When a stream is dead or the camera changes, dispose it before reacquiring.
    release();
    const requestId = ++requestIdRef.current;
    const stream = session ? await acquireSessionCamera(token.current, facing, profile, requireFacing)
      : await navigator.mediaDevices.getUserMedia({
      video: { facingMode: requireFacing ? { exact: facing } : { ideal: facing }, ...videoRecordingConstraints(profile) },
      audio: { echoCancellation: true, noiseSuppression: true },
    });
    if (!stream) return null;
    if (!mountedRef.current || requestId !== requestIdRef.current) {
      if (!session) stream.getTracks().forEach((track) => track.stop());
      return null;
    }
    if (!session && requireFacing && !matchesCameraFacing(stream, facing)) {
      stream.getTracks().forEach(track => track.stop());
      throw new DOMException('Requested camera unavailable', 'OverconstrainedError');
    }

    streamRef.current = stream;
    facingRef.current = facing;
    return stream;
  }, [liveStream, profile, release, session]);

  useEffect(() => {
    mountedRef.current = true;
    // pagehide covers full Mini App navigation/closure in WebViews that keep React mounted.
    window.addEventListener('pagehide', release);
    return () => {
      mountedRef.current = false;
      window.removeEventListener('pagehide', release);
      release();
    };
  }, [release]);

  return { acquire, liveStream, release,
    hasStream: (facing: VideoNoteFacingMode, includeOtherProfiles = false) => liveStream(facing) !== null
      || (session && (includeOtherProfiles ? hasCameraSessionAccess() : hasSessionCamera(facing, profile))) };
}
