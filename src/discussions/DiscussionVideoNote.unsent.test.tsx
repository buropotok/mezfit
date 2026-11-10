// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { DiscussionVideoNote } from './DiscussionVideoNote';

vi.mock('./useDiscussionMediaSource', () => ({
  useDiscussionMediaSource: (src: string) => ({ url: src, container: null }),
}));
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it('decodes a paused review frame and keeps the unsent player after repeated playback endings', () => {
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  const host = document.createElement('div'); document.body.appendChild(host);
  try {
    render(<DiscussionVideoNote src="blob:unsent" durationSeconds={2} playbackHost={host} review />);
    const video = screen.getByLabelText('Записанный видеокружок');
    if (!(video instanceof HTMLVideoElement)) throw new Error('Missing video');
    Object.defineProperty(video, 'duration', { configurable: true, value: 2 });
    fireEvent.loadedMetadata(video);
    expect(video.currentTime).toBeGreaterThan(0);
    for (let i = 0; i < 3; i += 1) {
      fireEvent.ended(video);
      fireEvent.pointerDown(document.body);
      expect(host.contains(video)).toBe(true);
      expect(screen.getByRole('button', { name: 'Воспроизвести' })).toBeTruthy();
    }
  } finally { cleanup(); host.remove(); }
});
