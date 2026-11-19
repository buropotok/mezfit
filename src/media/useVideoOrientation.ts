import { useEffect, useState, type CSSProperties, type RefObject } from 'react';
import { readVideoOrientation, rotatedVideoScale, type VideoOrientation } from './videoOrientation';
import { loadVideoPlaybackCopy } from './videoPlaybackCopy';

/** Thumbnails and players display only a source with known, neutral native rotation. */
export function useVideoOrientation(
  ref: RefObject<HTMLVideoElement | null>, src: string | undefined, fit: 'contain' | 'cover', resetKey?: string,
) {
  const identity = JSON.stringify([src, fit, resetKey]);
  const [result, setResult] = useState<{
    identity: string; url: string; track: VideoOrientation | null; scale: number; visible: boolean; error?: string;
  } | null>(null);
  useEffect(() => {
    const video = ref.current;
    if (!video || !src) return;
    const controller = new AbortController();
    let started = false;
    let prepared = false;
    let neutralFrameReady = false;
    let resume = false;
    let restoreTime: number | null = null;
    let objectUrl: string | undefined;
    let track: VideoOrientation | null = null;
    const fail = () => setResult({ identity, url: src, track: null, scale: 1, visible: false,
      error: 'Не удалось подготовить ориентацию видео. Повторите попытку.' });
    const timeout = setTimeout(() => controller.abort(), 60_000);
    controller.signal.addEventListener('abort', fail, { once: true });
    const publish = () => {
      if (controller.signal.aborted || !prepared || !track) return;
      const scale = track.rotation === 90 || track.rotation === 270 ? rotatedVideoScale(
        video.clientWidth, video.clientHeight, track.width, track.height, fit,
      ) : 1;
      setResult({ identity, url: objectUrl ?? src, track, scale, visible: !objectUrl || neutralFrameReady });
    };
    const inspect = () => {
      if (started || !video.videoWidth || !video.videoHeight) return;
      started = true;
      void (async () => {
        try {
          track = await readVideoOrientation(src, controller.signal);
          controller.signal.throwIfAborted();
          if (!track) throw new Error('VIDEO_ORIENTATION_METADATA_UNAVAILABLE');
          if (track.rotation || track.flip) {
            const blob = await loadVideoPlaybackCopy(src, controller.signal);
            controller.signal.throwIfAborted();
            resume = !video.paused;
            restoreTime = Number.isFinite(video.currentTime) ? video.currentTime : 0;
            objectUrl = URL.createObjectURL(blob);
          }
          prepared = true;
          clearTimeout(timeout);
          publish();
        } catch {
          if (controller.signal.aborted) return;
          clearTimeout(timeout);
          fail();
        }
      })();
    };
    const ready = () => {
      if (!objectUrl || !prepared || controller.signal.aborted || video.src !== objectUrl) return;
      neutralFrameReady = true;
      if (restoreTime !== null) {
        const time = restoreTime;
        restoreTime = null;
        if (time > 0) video.currentTime = Number.isFinite(video.duration) ? Math.min(time, video.duration) : time;
      }
      publish();
      if (resume) {
        resume = false;
        void video.play().catch(() => { /* The existing play control remains available. */ });
      }
    };
    video.addEventListener('loadedmetadata', inspect);
    video.addEventListener('loadeddata', ready);
    const resized = () => { inspect(); publish(); };
    video.addEventListener('resize', resized);
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(publish);
    observer?.observe(video);
    if (video.readyState >= 1) inspect();
    return () => {
      controller.signal.removeEventListener('abort', fail);
      controller.abort();
      clearTimeout(timeout);
      observer?.disconnect();
      video.removeEventListener('loadedmetadata', inspect);
      video.removeEventListener('loadeddata', ready);
      video.removeEventListener('resize', resized);
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [ref, src, fit, identity]);
  const current = result?.identity === identity ? result : null;
  const track = current?.track;
  const rotation = track?.rotation ?? 0;
  const flip = track?.flip ?? false;
  const pending = Boolean(src && (!current || !current.visible && !current.error));
  const transformed: CSSProperties | undefined = rotation || flip ? {
      transform: `scaleX(${flip ? -1 : 1}) rotate(${rotation}deg) scale(${current?.scale ?? 1})`,
      transformOrigin: 'center',
    } : undefined;
  const style: CSSProperties | undefined = src && !current?.visible ? { ...transformed, visibility: 'hidden' } : transformed;
  return { src: current?.url ?? src, rotation, flip, style, pending, error: current?.error };
}
