// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { DiscussionVideoNote } from './DiscussionVideoNote';

vi.mock('./useDiscussionMediaSource', () => ({
  useDiscussionMediaSource: (src: string) => ({ url: src, container: null }),
}));
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it('opens an unsent locked take expanded and keeps it there after outside taps and playback end', () => {
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  const host = document.createElement('div');
  document.body.appendChild(host);
  try {
    render(<DiscussionVideoNote src="blob:take" durationSeconds={10} playbackHost={host} review />);
    const video = screen.getByLabelText('Записанный видеокружок');
    expect(host.contains(video)).toBe(true);
    expect(screen.queryByRole('button', { name: 'Открыть видеокружок' })).toBeNull();
    fireEvent.pointerDown(document.body);
    fireEvent.ended(video);
    expect(host.contains(video)).toBe(true);
    expect(screen.getByRole('slider', { name: 'Перемотка видеокружка' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Открыть видеокружок' })).toBeNull();
  } finally { cleanup(); host.remove(); }
});
