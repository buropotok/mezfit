import { retainSessionMicrophone } from '../voice-note/sessionMicrophone';
import { videoRecordingConstraints, type VideoRecordingProfile } from './video-recording-profile';
import type { VideoNoteFacingMode } from './useVideoNoteCameraSession';

let source: MediaStream | undefined;
let configuration: string | undefined;
let pending: Promise<void> | undefined;
let owner: symbol | undefined;
let generation = 0;

function closeSession() {
  generation += 1;
  pending = undefined;
  owner = undefined;
  configuration = undefined;
  source?.getTracks().forEach(track => track.stop());
  source = undefined;
  window.removeEventListener('pagehide', closeSession);
}

export function hasCameraSessionAccess() {
  const tracks = source?.getTracks() ?? [];
  return tracks.length > 0 && tracks.every(track => track.readyState !== 'ended');
}

export function matchesCameraFacing(stream: MediaStream, facing: VideoNoteFacingMode) {
  const actualFacing = stream.getVideoTracks()[0]?.getSettings?.().facingMode;
  return !actualFacing || actualFacing === facing;
}

export function hasSessionCamera(facing: VideoNoteFacingMode, profile: VideoRecordingProfile, requireFacing = false) {
  const tracks = source?.getTracks() ?? [];
  return !!source && configuration === JSON.stringify([facing, profile]) && tracks.length > 0
    && tracks.every(track => track.readyState !== 'ended') && (!requireFacing || matchesCameraFacing(source, facing));
}

export function ownsSessionCamera(token: symbol) {
  return owner === token;
}

export function parkSessionCamera(token: symbol) {
  if (owner !== token) return;
  owner = undefined;
  source?.getTracks().forEach(track => { track.enabled = false; });
}

/** A screen borrows the shared source. Only pagehide or a camera switch ends it. */
export async function acquireSessionCamera(
  token: symbol, facing: VideoNoteFacingMode, profile: VideoRecordingProfile, requireFacing = false,
): Promise<MediaStream | null> {
  if (owner && owner !== token) throw new DOMException('Camera in use', 'NotReadableError');
  const key = JSON.stringify([facing, profile]);
  if (configuration !== key || (!pending && !hasSessionCamera(facing, profile, requireFacing))) {
    closeSession();
    configuration = key;
  }
  owner = token;
  const acquisitionGeneration = generation;
  window.addEventListener('pagehide', closeSession, { once: true });
  if (!hasSessionCamera(facing, profile, requireFacing) && !pending) {
    const requestGeneration = generation;
    const request = navigator.mediaDevices.getUserMedia({
      video: { facingMode: requireFacing ? { exact: facing } : { ideal: facing }, ...videoRecordingConstraints(profile) },
      audio: { echoCancellation: true, noiseSuppression: true },
    }).then(stream => {
      if (generation !== requestGeneration) {
        stream.getTracks().forEach(track => track.stop());
        throw new DOMException('Camera session closed', 'AbortError');
      }
      if (requireFacing && !matchesCameraFacing(stream, facing)) {
        stream.getTracks().forEach(track => track.stop());
        throw new DOMException('Requested camera unavailable', 'OverconstrainedError');
      }
      stream.getTracks().forEach(track => { track.enabled = false; });
      source = stream;
      retainSessionMicrophone(stream);
    }).finally(() => {
      if (pending === request) pending = undefined;
    });
    pending = request;
  }
  try {
    await pending;
    if (owner !== token || !source) return null;
    if (requireFacing && !matchesCameraFacing(source, facing)) {
      throw new DOMException('Requested camera unavailable', 'OverconstrainedError');
    }
    return source;
  } catch (error) {
    if (generation === acquisitionGeneration) parkSessionCamera(token);
    throw error;
  }
}
