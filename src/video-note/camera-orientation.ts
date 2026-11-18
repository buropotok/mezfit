import type { VideoRecordingProfile } from './video-recording-profile';

type CameraOrientation = Exclude<VideoRecordingProfile, 'circle'>;

export function matchesCameraOrientation(video: HTMLVideoElement, profile: CameraOrientation): boolean {
  return video.readyState >= 2 && (profile === 'portrait'
    ? video.videoHeight > video.videoWidth
    : video.videoWidth > video.videoHeight);
}

/** Wait for a decoded frame, with bounded cleanup on cancellation or a stalled camera. */
export function waitForCameraFrame(
  video: HTMLVideoElement, signal: AbortSignal, orientation?: CameraOrientation,
): Promise<boolean> {
  if (signal.aborted) return Promise.resolve(false);
  const ready = () => video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0
    && (!orientation || matchesCameraOrientation(video, orientation));
  if (typeof video.requestVideoFrameCallback !== 'function' && ready()) return Promise.resolve(true);

  return new Promise(resolve => {
    let frameId: number | undefined;
    const timeout = window.setTimeout(() => finish(false), 2500);
    const finish = (result: boolean) => {
      window.clearTimeout(timeout);
      signal.removeEventListener('abort', abort);
      video.removeEventListener('loadeddata', check);
      video.removeEventListener('resize', check);
      if (frameId !== undefined) video.cancelVideoFrameCallback?.(frameId);
      resolve(result);
    };
    const abort = () => finish(false);
    const check = () => { if (ready()) finish(true); };
    const nextFrame: VideoFrameRequestCallback = () => {
      frameId = undefined;
      if (ready()) finish(true);
      else frameId = video.requestVideoFrameCallback(nextFrame);
    };
    signal.addEventListener('abort', abort, { once: true });
    if (typeof video.requestVideoFrameCallback === 'function') {
      frameId = video.requestVideoFrameCallback(nextFrame);
    } else {
      video.addEventListener('loadeddata', check);
      video.addEventListener('resize', check);
    }
  });
}
