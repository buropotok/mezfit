// @vitest-environment jsdom
import { useState } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CircularVideoPlayback, type VideoNotePlaybackMode } from './CircularVideoPlayback';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function PlayerHarness({ onError = vi.fn() }: { onError?: (message: string) => void }) {
  const [mode, setMode] = useState<VideoNotePlaybackMode>('preview');
  return (
    <CircularVideoPlayback
      src="blob:recorded-note"
      fallbackDuration={12}
      onError={onError}
      mode={mode}
      onExpand={() => setMode('play')}
      onReturnToPreview={() => setMode('preview')}
    />
  );
}

describe('video note first-frame Preview and full-size Play', () => {
  it('preloads the first decodable frame without playing, then plays on tap and returns to Preview at the end', async () => {
    const { container } = render(<PlayerHarness />);
    const video = screen.getByLabelText('Записанный видеокружок') as HTMLVideoElement;
    const play = vi.spyOn(video, 'play').mockResolvedValue();
    Object.defineProperty(video, 'readyState', { configurable: true, value: 1 });
    Object.defineProperty(video, 'duration', { configurable: true, value: 12 });

    fireEvent.loadedMetadata(video);
    expect(video.currentTime).toBeCloseTo(0.04);
    expect(video.getAttribute('preload')).toBe('auto');
    expect(play).not.toHaveBeenCalled();
    expect(screen.queryByRole('slider', { name: 'Перемотка видеокружка' })).toBeNull();
    expect(container.querySelector('.video-note-playback__play-glyph')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Открыть видеокружок' }));
    expect(play).toHaveBeenCalledOnce();
    expect(screen.getByRole('slider', { name: 'Перемотка видеокружка' })).toBeTruthy();
    expect(screen.getByLabelText('Записанный видеокружок')).toBe(video);

    fireEvent.ended(video);
    expect(screen.getByRole('button', { name: 'Открыть видеокружок' })).toBeTruthy();
    expect(screen.queryByRole('slider', { name: 'Перемотка видеокружка' })).toBeNull();
    expect(container.querySelector('.video-note-playback__play-glyph')).toBeNull();
    expect(video.currentTime).toBeCloseTo(0.04);
  });

  it('returns to compact Preview when the WebView refuses to play', async () => {
    const onError = vi.fn();
    render(<PlayerHarness onError={onError} />);
    const video = screen.getByLabelText('Записанный видеокружок') as HTMLVideoElement;
    vi.spyOn(video, 'play').mockRejectedValue(new Error('Playback blocked'));

    fireEvent.click(screen.getByRole('button', { name: 'Открыть видеокружок' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Открыть видеокружок' })).toBeTruthy());
    expect(onError).toHaveBeenCalledWith(expect.stringMatching(/воспроизвести/));
    expect(screen.queryByRole('slider', { name: 'Перемотка видеокружка' })).toBeNull();
  });
});
