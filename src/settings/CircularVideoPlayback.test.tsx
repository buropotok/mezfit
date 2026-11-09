// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CircularVideoPlayback, videoNoteSeekFraction } from './CircularVideoPlayback';

const area = { left: 10, top: 20, width: 200, height: 200 };

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function setup() {
  const onError = vi.fn();
  const { container, unmount } = render(
    <CircularVideoPlayback src="blob:video-note" fallbackDuration={40} onError={onError} />,
  );
  const video = screen.getByLabelText('Записанный видеокружок') as HTMLVideoElement;
  const slider = screen.getByRole('slider', { name: 'Перемотка видеокружка' });
  const rail = container.querySelector<SVGCircleElement>('.video-note-playback__seek-hit');
  const marker = container.querySelector<SVGCircleElement>('.video-note-playback__marker');
  if (!rail || !marker) throw new Error('Missing video-note seek rail');
  let paused = true;
  Object.defineProperty(video, 'paused', { configurable: true, get: () => paused });
  Object.defineProperty(video, 'duration', { configurable: true, value: 40 });
  Object.defineProperty(video, 'readyState', { configurable: true, value: 1 });
  const play = vi.spyOn(video, 'play').mockImplementation(() => {
    paused = false;
    fireEvent.play(video);
    return Promise.resolve();
  });
  const pause = vi.spyOn(video, 'pause').mockImplementation(() => {
    paused = true;
    fireEvent.pause(video);
  });
  vi.spyOn(slider, 'getBoundingClientRect').mockReturnValue({
    ...area, x: area.left, y: area.top, right: area.left + area.width, bottom: area.top + area.height,
    toJSON: () => ({}),
  });
  fireEvent.loadedMetadata(video);
  return { video, slider, rail, marker, play, pause, onError, unmount };
}

describe('circular video-note playback', () => {
  it('maps the four cardinal points to positions along a clockwise circle', () => {
    expect(videoNoteSeekFraction(110, 20, area)).toBeCloseTo(0);
    expect(videoNoteSeekFraction(210, 120, area)).toBeCloseTo(0.25);
    expect(videoNoteSeekFraction(110, 220, area)).toBeCloseTo(0.5);
    expect(videoNoteSeekFraction(10, 120, area)).toBeCloseTo(0.75);
  });

  it('plays and pauses by tapping the video itself, without external playback buttons', async () => {
    const { video, play, pause } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Воспроизвести' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Пауза' })).toBeTruthy());
    expect(play).toHaveBeenCalledOnce();

    video.currentTime = 10;
    fireEvent.timeUpdate(video);
    expect(screen.getByRole('slider', { name: 'Перемотка видеокружка' }).getAttribute('aria-valuenow')).toBe('25');

    fireEvent.click(screen.getByRole('button', { name: 'Пауза' }));
    expect(pause).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: 'Воспроизвести' })).toBeTruthy();
  });

  it('drags the circular marker, pauses during scrubbing and resumes after release', async () => {
    const { video, rail, slider, marker, play, pause } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Воспроизвести' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Пауза' })).toBeTruthy());

    fireEvent.pointerDown(rail, { pointerId: 7, clientX: 210, clientY: 120 });
    expect(pause).toHaveBeenCalledOnce();
    expect(video.currentTime).toBeCloseTo(10);
    expect(slider.getAttribute('aria-valuenow')).toBe('25');
    expect(Number(marker.getAttribute('cx'))).toBeGreaterThan(90);

    fireEvent.pointerMove(rail, { pointerId: 7, clientX: 110, clientY: 220 });
    expect(video.currentTime).toBeCloseTo(20);
    expect(slider.getAttribute('aria-valuenow')).toBe('50');

    fireEvent.pointerUp(rail, { pointerId: 7, clientX: 110, clientY: 220 });
    await waitFor(() => expect(play).toHaveBeenCalledTimes(2));
    expect(slider.getAttribute('aria-valuenow')).toBe('50');
  });

  it('seeks while paused without starting playback, and restarts from the beginning after ended', () => {
    const { video, rail, slider, play } = setup();
    fireEvent.pointerDown(rail, { pointerId: 2, clientX: 10, clientY: 120 });
    fireEvent.pointerUp(rail, { pointerId: 2, clientX: 10, clientY: 120 });
    expect(video.currentTime).toBeCloseTo(30);
    expect(play).not.toHaveBeenCalled();
    expect(slider.getAttribute('aria-valuenow')).toBe('75');

    fireEvent.ended(video);
    expect(video.currentTime).toBe(0);
    expect(slider.getAttribute('aria-valuenow')).toBe('0');
  });

  it('keeps the recorded duration visible and seek disabled before metadata arrives', () => {
    render(<CircularVideoPlayback src="blob:video-note" fallbackDuration={17} onError={vi.fn()} />);
    const slider = screen.getByRole('slider', { name: 'Перемотка видеокружка' });
    expect(slider.getAttribute('aria-disabled')).toBe('true');
    expect(slider.getAttribute('aria-valuetext')).toBe('0 из 17 секунд');
  });

  it('pauses the video on unmount', async () => {
    const { video, play, pause, unmount } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Воспроизвести' }));
    await waitFor(() => expect(play).toHaveBeenCalledOnce());
    unmount();
    expect(pause).toHaveBeenCalled();
    expect(video.src).toContain('blob:video-note');
  });

  it('ignores playback completion after the player unmounts', async () => {
    const { video, unmount, onError } = setup();
    let rejectPlay: ((error: Error) => void) | undefined;
    vi.spyOn(video, 'play').mockImplementation(() => new Promise<void>((_, reject) => { rejectPlay = reject; }));
    fireEvent.click(screen.getByRole('button', { name: 'Воспроизвести' }));
    unmount();
    await act(async () => {
      rejectPlay?.(new Error('cancelled'));
      await Promise.resolve();
    });
    expect(onError).not.toHaveBeenCalled();
  });
});
