// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CircularVideoPlayback } from './CircularVideoPlayback';
import { VideoNoteRecordingRing, VideoNoteRing } from './VideoNoteRing';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('Telegram-style video-note ring', () => {
  it('uses an outer-edge ring during recording without an interactive marker', () => {
    const { container } = render(<VideoNoteRecordingRing progress={0.35} />);
    expect(screen.getByRole('img', { name: 'Прогресс записи видеокружка' })).toBeTruthy();
    expect(container.querySelector('.video-note-ring--recording')).toBeTruthy();
    expect(container.querySelector('.video-note-playback__marker')).toBeNull();
    const dash = container.querySelector('.video-note-ring__progress')?.getAttribute('stroke-dasharray');
    expect(Number(dash?.split(' ')[0])).toBeCloseTo(2 * Math.PI * 48.2 * 0.35);
  });

  it('keeps the marker on the paused inset ring, but hides it during playback', () => {
    const { container, rerender } = render(
      <svg><VideoNoteRing progress={0.25} mode="paused" /></svg>,
    );
    expect(container.querySelector('.video-note-ring--paused')).toBeTruthy();
    const marker = container.querySelector('.video-note-playback__marker');
    expect(marker).toBeTruthy();
    expect(Number(marker?.getAttribute('cx'))).toBeGreaterThan(90);

    rerender(<svg><VideoNoteRing progress={0.25} mode="playing" /></svg>);
    expect(container.querySelector('.video-note-ring--playing')).toBeTruthy();
    expect(container.querySelector('.video-note-ring--paused')).toBeNull();
  });

  it('springs between inset paused and edge playback states when tapping the video', async () => {
    const { container } = render(
      <CircularVideoPlayback src="blob:video-note" fallbackDuration={30} onError={vi.fn()} />,
    );
    const video = screen.getByLabelText('Записанный видеокружок') as HTMLVideoElement;
    let paused = true;
    Object.defineProperty(video, 'paused', { configurable: true, get: () => paused });
    vi.spyOn(video, 'play').mockImplementation(() => {
      paused = false;
      fireEvent.play(video);
      return Promise.resolve();
    });
    vi.spyOn(video, 'pause').mockImplementation(() => {
      paused = true;
      fireEvent.pause(video);
    });

    expect(container.querySelector('.video-note-playback--paused')).toBeTruthy();
    expect(container.querySelector('.video-note-ring--paused')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Воспроизвести' }));
    await waitFor(() => expect(container.querySelector('.video-note-ring--playing')).toBeTruthy());
    expect(container.querySelector('.video-note-playback--paused')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Пауза' }));
    expect(container.querySelector('.video-note-ring--paused')).toBeTruthy();
    expect(container.querySelector('.video-note-playback--paused')).toBeTruthy();
  });

  it('cancels native touch scrolling only while the circular seek is active', () => {
    const { container } = render(
      <CircularVideoPlayback src="blob:video-note" fallbackDuration={30} onError={vi.fn()} />,
    );
    const video = screen.getByLabelText('Записанный видеокружок') as HTMLVideoElement;
    Object.defineProperty(video, 'duration', { configurable: true, value: 30 });
    Object.defineProperty(video, 'readyState', { configurable: true, value: 1 });
    fireEvent.loadedMetadata(video);
    const slider = screen.getByRole('slider', { name: 'Перемотка видеокружка' });
    vi.spyOn(slider, 'getBoundingClientRect').mockReturnValue({
      left: 10, top: 10, width: 200, height: 200,
      x: 10, y: 10, right: 210, bottom: 210, toJSON: () => ({}),
    });
    const seekHit = container.querySelector('.video-note-playback__seek-hit');
    if (!seekHit) throw new Error('Missing circular seek hit target');
    const idleTouch = new Event('touchmove', { bubbles: true, cancelable: true });
    slider.dispatchEvent(idleTouch);
    expect(idleTouch.defaultPrevented).toBe(false);

    fireEvent.pointerDown(seekHit, { pointerId: 9, clientX: 110, clientY: 10 });
    const activeTouch = new Event('touchmove', { bubbles: true, cancelable: true });
    slider.dispatchEvent(activeTouch);
    expect(activeTouch.defaultPrevented).toBe(true);

    fireEvent.pointerUp(seekHit, { pointerId: 9, clientX: 210, clientY: 110 });
    const releasedTouch = new Event('touchmove', { bubbles: true, cancelable: true });
    slider.dispatchEvent(releasedTouch);
    expect(releasedTouch.defaultPrevented).toBe(false);
  });
});
