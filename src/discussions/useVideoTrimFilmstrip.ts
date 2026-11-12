import { useEffect, useState } from 'react';

export const VIDEO_TRIM_FRAME_COUNT = 8;

function waitForFrame(video: HTMLVideoElement, event: 'loadeddata' | 'seeked', signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(fail, 4_000);
    const cleanup = () => {
      window.clearTimeout(timer);
      video.removeEventListener(event, ready);
      video.removeEventListener('error', fail);
      signal.removeEventListener('abort', fail);
    };
    function ready() { cleanup(); resolve(); }
    function fail() { cleanup(); reject(new Error('Video frame unavailable')); }
    if (signal.aborted) { fail(); return; }
    video.addEventListener(event, ready, { once: true });
    video.addEventListener('error', fail, { once: true });
    signal.addEventListener('abort', fail, { once: true });
  });
}

export function useVideoTrimFilmstrip(src: string | undefined, duration: number) {
  const [frames, setFrames] = useState<string[]>([]);
  useEffect(() => {
    if (!src || !duration) return;
    setFrames([]);
    const controller = new AbortController();
    const { signal } = controller;
    const video = document.createElement('video');
    video.preload = 'auto';
    video.muted = true;
    video.playsInline = true;
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) return;
    canvas.width = 96;
    canvas.height = 64;

    const collect = async () => {
      const firstFrame = waitForFrame(video, 'loadeddata', signal);
      video.src = src;
      await firstFrame;
      const scale = Math.max(canvas.width / video.videoWidth, canvas.height / video.videoHeight);
      const width = video.videoWidth * scale;
      const height = video.videoHeight * scale;
      if (!Number.isFinite(width) || !Number.isFinite(height)) return;
      for (let index = 0; index < VIDEO_TRIM_FRAME_COUNT; index += 1) {
        signal.throwIfAborted();
        if (index > 0) {
          const seek = waitForFrame(video, 'seeked', signal);
          video.currentTime = index * duration / VIDEO_TRIM_FRAME_COUNT;
          await seek;
        }
        signal.throwIfAborted();
        context.drawImage(video, (canvas.width - width) / 2, (canvas.height - height) / 2, width, height);
        const frame = canvas.toDataURL('image/jpeg', 0.7);
        setFrames(current => [...current, frame]);
      }
    };

    const release = () => {
      if (!video.hasAttribute('src')) return;
      video.removeAttribute('src');
      video.load();
    };
    void collect().catch(() => {
      // The controls stay usable on WebViews that cannot decode a second video element.
    }).finally(release);
    return () => { controller.abort(); release(); };
  }, [src, duration]);
  return frames;
}
