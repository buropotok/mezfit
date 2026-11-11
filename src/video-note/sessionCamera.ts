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

export function hasSessionCamera(facing: VideoNoteFacingMode, profile: VideoRecordingProfile) {
  const tracks = source?.getTracks() ?? [];
  return configuration === JSON.stringify([facing, profile]) && tracks.length > 0
    && tracks.every(track => track.readyState !== 'ended');
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
  if (configuration !== key || (!pending && !hasSessionCamera(facing, profile))) {
    closeSession();
    configuration = key;
  }
  owner = token;
  const acquisitionGeneration = generation;
  window.addEventListener('pagehide', closeSession, { once: true });
  if (!hasSessionCamera(facing, profile) && !pending) {
    const requestGeneration = generation;
    const request = navigator.mediaDevices.getUserMedia({
      video: { facingMode: requireFacing ? { exact: facing } : { ideal: facing }, ...videoRecordingConstraints(profile) },
      audio: { echoCancellation: true, noiseSuppression: true },
    }).then(stream => {
      if (generation !== requestGeneration) {
        stream.getTracks().forEach(track => track.stop());
        throw new DOMException('Camera session closed', 'AbortError');
      }
      const actualFacing = requireFacing ? stream.getVideoTracks()[0]?.getSettings?.().facingMode : undefined;
      if (requireFacing && actualFacing && actualFacing !== facing) {
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
    return owner === token ? source ?? null : null;
  } catch (error) {
    if (generation === acquisitionGeneration) parkSessionCamera(token);
    throw error;
  }
}
