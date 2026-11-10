// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { DiscussionVideoNote } from './DiscussionVideoNote';

vi.mock('./useDiscussionMediaSource', () => ({
  useDiscussionMediaSource: (src: string) => ({ url: src, container: null }),
}));
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it.each([true, false])('collapses an expanded note after outside contact while playing=%s', playing => {
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
  const host = document.createElement('div');
  document.body.appendChild(host);
  try {
    render(<DiscussionVideoNote src="blob:circle" durationSeconds={10} playbackHost={host} />);
    const video = screen.getByLabelText('Записанный видеокружок');
    fireEvent.click(screen.getByRole('button', { name: 'Открыть видеокружок' }));
    expect(host.contains(video)).toBe(true);
    Object.defineProperty(video, 'paused', { configurable: true, value: !playing });
    if (playing) fireEvent.play(video);
    fireEvent.pointerDown(video);
    expect(screen.getByRole('slider', { name: 'Перемотка видеокружка' })).toBeTruthy();
    fireEvent.pointerDown(document.body);
    expect(screen.getByRole('button', { name: 'Открыть видеокружок' })).toBeTruthy();
    expect(host.contains(video)).toBe(false);
    expect(screen.getByLabelText('Записанный видеокружок')).toBe(video);
    expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled();
  } finally {
    cleanup();
    host.remove();
  }
});
