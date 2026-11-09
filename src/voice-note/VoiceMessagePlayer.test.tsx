// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VoiceMessagePlayer, formatVoiceDuration } from './VoiceMessagePlayer';

beforeEach(() => {
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderPlayer() {
  const onError = vi.fn();
  const view = render(
    <VoiceMessagePlayer
      src="blob:voice-test"
      durationMs={4000}
      waveform={[0.1, 0.5, 1, 0.2]}
      onError={onError}
    />,
  );
  const audio = screen.getByLabelText('Аудиозапись') as HTMLAudioElement;
  let paused = true;
  Object.defineProperty(audio, 'paused', { configurable: true, get: () => paused });
  Object.defineProperty(audio, 'duration', { configurable: true, value: 4 });
  const play = vi.spyOn(audio, 'play').mockImplementation(() => {
    paused = false;
    fireEvent.play(audio);
    return Promise.resolve();
  });
  const pause = vi.spyOn(audio, 'pause').mockImplementation(() => {
    paused = true;
    fireEvent.pause(audio);
  });
  return { ...view, audio, play, pause, onError };
}

describe('voice message bubble player', () => {
  it('formats voice duration with a zero-padded mm:ss label', () => {
    expect(formatVoiceDuration(3)).toBe('00:03');
    expect(formatVoiceDuration(65)).toBe('01:05');
    expect(formatVoiceDuration(Number.NaN)).toBe('00:00');
  });

  it('shows large play/pause, real waveform and elapsed progress inside the bubble content', async () => {
    const { container, audio, play, pause } = renderPlayer();
    expect(screen.getByText('00:04')).toBeTruthy();
    expect(container.querySelectorAll('.voice-message-player__waveform rect')).toHaveLength(4);
    fireEvent.click(screen.getByRole('button', { name: 'Воспроизвести голосовое сообщение' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Приостановить голосовое сообщение' })).toBeTruthy());
    expect(play).toHaveBeenCalledOnce();

    audio.currentTime = 2;
    fireEvent.timeUpdate(audio);
    expect(screen.getByText('00:02')).toBeTruthy();
    expect(screen.getByRole('slider', { name: 'Перемотка голосового сообщения' }).getAttribute('aria-valuenow')).toBe('50');

    fireEvent.click(screen.getByRole('button', { name: 'Приостановить голосовое сообщение' }));
    expect(pause).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: 'Воспроизвести голосовое сообщение' })).toBeTruthy();
  });

  it('seeks by dragging across the waveform and resets at the end', () => {
    const { audio, container } = renderPlayer();
    const slider = screen.getByRole('slider', { name: 'Перемотка голосового сообщения' });
    vi.spyOn(slider, 'getBoundingClientRect').mockReturnValue({
      left: 20, top: 0, width: 200, height: 32,
      x: 20, y: 0, right: 220, bottom: 32, toJSON: () => ({}),
    });
    fireEvent.pointerDown(slider, { pointerId: 8, clientX: 70, clientY: 12 });
    expect(audio.currentTime).toBeCloseTo(1);
    fireEvent.pointerMove(slider, { pointerId: 8, clientX: 170, clientY: 12 });
    expect(audio.currentTime).toBeCloseTo(3);
    expect(slider.getAttribute('aria-valuenow')).toBe('75');
    fireEvent.pointerUp(slider, { pointerId: 8, clientX: 170, clientY: 12 });

    fireEvent.ended(audio);
    expect(audio.currentTime).toBe(0);
    expect(slider.getAttribute('aria-valuenow')).toBe('0');
    expect(container.querySelector('.voice-message-player')).toBeTruthy();
  });

  it('renders a neutral flat fallback if a WebView cannot decode any waveform data', () => {
    const { container } = render(<VoiceMessagePlayer src="blob:audio" waveform={[]} durationMs={3000} />);
    const bars = container.querySelectorAll('.voice-message-player__waveform rect');
    expect(bars).toHaveLength(42);
    expect(new Set(Array.from(bars, (bar) => bar.getAttribute('height'))).size).toBe(1);
  });

  it('keeps play and seek taps inside the bubble instead of opening the message menu', () => {
    const onBubbleClick = vi.fn();
    render(
      <div onClick={onBubbleClick}>
        <VoiceMessagePlayer src="blob:voice" waveform={[0.1, 0.6]} durationMs={3000} />
      </div>,
    );
    const audio = screen.getByLabelText('Аудиозапись') as HTMLAudioElement;
    vi.spyOn(audio, 'play').mockResolvedValue();
    fireEvent.click(screen.getByRole('button', { name: 'Воспроизвести голосовое сообщение' }));
    expect(onBubbleClick).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('slider', { name: 'Перемотка голосового сообщения' }));
    expect(onBubbleClick).not.toHaveBeenCalled();
  });

  it('does not report an obsolete playback failure after unmount', async () => {
    const { unmount, audio, onError } = renderPlayer();
    let rejectPlay: ((cause: Error) => void) | undefined;
    vi.spyOn(audio, 'play').mockImplementation(() => new Promise<void>((_, reject) => {
      rejectPlay = reject;
    }));
    fireEvent.click(screen.getByRole('button', { name: 'Воспроизвести голосовое сообщение' }));
    unmount();
    await act(async () => {
      rejectPlay?.(new Error('closed'));
      await Promise.resolve();
    });
    expect(onError).not.toHaveBeenCalled();
  });
});
