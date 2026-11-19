import { useEffect, useState, type CSSProperties, type RefObject } from 'react';
import { missingVideoRotation, readVideoOrientation, rotatedVideoScale, type VideoOrientation } from './videoOrientation';

/** Owns only the supplied player; source changes cancel stale metadata reads. */
export function useVideoOrientation(
  ref: RefObject<HTMLVideoElement | null>, src: string | undefined, fit: 'contain' | 'cover', resetKey?: string,
) {
  const [result, setResult] = useState<{ src: string; rotation: number; scale: number } | null>(null);
  useEffect(() => {
    const video = ref.current;
    if (!video || !src) return;
    const controller = new AbortController();
    let started = false;
    let track: VideoOrientation | null = null;
    const measure = () => {
      if (controller.signal.aborted) return;
      const rotation = track ? missingVideoRotation(video.videoWidth, video.videoHeight, track) : 0;
      const scale = rotation ? rotatedVideoScale(
        video.clientWidth, video.clientHeight, video.videoWidth, video.videoHeight, fit,
      ) : 1;
      setResult({ src, rotation, scale });
    };
    const inspect = () => {
      // The owner explicitly excludes square recordings, including existing clips.
      if (started || !video.videoWidth || !video.videoHeight || video.videoWidth === video.videoHeight) return;
      started = true;
      void readVideoOrientation(src, controller.signal).then(metadata => {
        if (controller.signal.aborted) return;
        track = metadata;
        measure();
      });
    };
    video.addEventListener('loadedmetadata', inspect);
    const resized = () => { inspect(); measure(); };
    video.addEventListener('resize', resized);
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(measure);
    observer?.observe(video);
    if (video.readyState >= 1) inspect();
    return () => {
      controller.abort();
      observer?.disconnect();
      video.removeEventListener('loadedmetadata', inspect);
      video.removeEventListener('resize', resized);
    };
  }, [ref, src, fit, resetKey]);
  const rotation = result?.src === src ? result.rotation : 0;
  const style: CSSProperties | undefined = rotation ? {
    transform: `rotate(${rotation}deg) scale(${result?.scale ?? 1})`,
    transformOrigin: 'center',
  } : undefined;
  return { rotation, style };
}
