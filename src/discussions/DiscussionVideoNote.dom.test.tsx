// @vitest-environment jsdom
import { useRef, useState } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { DiscussionVideoNote } from './DiscussionVideoNote';

vi.mock('./useDiscussionMediaSource', () => ({
  useDiscussionMediaSource: (src: string) => ({ url: src, container: null }),
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function Harness({ review = false, opened = true }: { review?: boolean; opened?: boolean }) {
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  const scrollViewport = useRef<HTMLDivElement>(null);
  return <>
    <div ref={scrollViewport} data-testid="scroll-viewport">
      {opened && <DiscussionVideoNote src="blob:circle" durationSeconds={10}
        playbackHost={host} scrollViewport={scrollViewport} review={review} />}
    </div>
    <div ref={setHost} data-testid="playback-host" />
  </>;
}

it('keeps the playing video connected to the same DOM ancestors across repeated transitions', async () => {
  const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
  const { rerender } = render(<Harness />);
  const host = screen.getByTestId('playback-host');
  const video = screen.getByLabelText<HTMLVideoElement>('Записанный видеокружок');
  const parent = video.parentElement;
  const layer = host.firstElementChild;
  const preview = () => screen.getByRole('button', { name: 'Открыть видеокружок' });
  const changes = new MutationObserver(() => {});
  changes.observe(host, { childList: true, subtree: true, attributes: true, attributeFilter: ['src'] });

  try {
    expect(host.contains(video)).toBe(true);
    expect(play).not.toHaveBeenCalled();
    for (const dismiss of [() => fireEvent.pointerDown(document.body), () => fireEvent.ended(video)]) {
      pause.mockClear();
      const tap = new MouseEvent('click', { bubbles: true, cancelable: true });
      let phaseAtPlay: number = Event.NONE;
      play.mockReset().mockImplementation(() => {
        phaseAtPlay = tap.eventPhase;
        return Promise.resolve();
      });
      fireEvent(preview(), tap);
      expect(play).toHaveBeenCalledOnce();
      expect(phaseAtPlay).toBe(Event.BUBBLING_PHASE);
      await act(async () => {});
      expect(screen.getByRole('slider', { name: 'Перемотка видеокружка' })).toBeTruthy();
      expect(video.parentNode).toBe(parent);
      expect(layer?.parentNode).toBe(host);
      expect(pause).not.toHaveBeenCalled();

      dismiss();
      expect(preview()).toBeTruthy();
      expect(pause).toHaveBeenCalledOnce();
      expect(screen.getByLabelText('Записанный видеокружок')).toBe(video);
      expect(video.parentNode).toBe(parent);
      expect(video.getAttribute('src')).toBe('blob:circle');
    }
    const mutations = changes.takeRecords();
    expect(mutations.some(record => record.type === 'attributes')).toBe(false);
    for (const record of mutations) {
      for (const node of [...record.addedNodes, ...record.removedNodes]) {
        expect(node.contains(video)).toBe(false);
      }
    }
  } finally {
    changes.disconnect();
  }

  const removeListener = vi.spyOn(document, 'removeEventListener');
  play.mockReset().mockResolvedValue();
  await act(async () => { fireEvent.click(preview()); });
  pause.mockClear();
  rerender(<Harness opened={false} />);
  expect(removeListener).toHaveBeenCalledWith('pointerdown', expect.any(Function), true);
  expect(pause).toHaveBeenCalledOnce();
  expect(video.isConnected).toBe(false);
  expect(host.childElementCount).toBe(0);
});

it('keeps an unsent review mounted and paused initially, then cleans up on dismissal', async () => {
  const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
  const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  const { unmount } = render(<Harness review />);
  const host = screen.getByTestId('playback-host');
  const video = screen.getByLabelText('Записанный видеокружок');
  const parent = video.parentNode;
  expect(play).not.toHaveBeenCalled();

  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Воспроизвести' })); });
  expect(play).toHaveBeenCalledOnce();
  fireEvent.ended(video);
  fireEvent.pointerDown(document.body);
  expect(screen.getByRole('slider', { name: 'Перемотка видеокружка' })).toBeTruthy();
  expect(host.contains(video)).toBe(true);
  expect(video.parentNode).toBe(parent);

  unmount();
  expect(host.childElementCount).toBe(0);
  expect(pause).toHaveBeenCalledOnce();
});

it('repositions and clips the compact image when the chat scrolls or resizes', () => {
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  const { rerender } = render(<Harness />);
  const host = screen.getByTestId('playback-host');
  const viewport = screen.getByTestId('scroll-viewport');
  const slot = screen.getByRole('button', { name: 'Открыть видеокружок' }).parentElement;
  const layer = host.firstElementChild;
  if (!slot || !(layer instanceof HTMLElement)) throw new Error('Missing compact video layer');
  vi.spyOn(host, 'getBoundingClientRect').mockReturnValue(new DOMRect(12, 60, 360, 420));
  const measureViewport = vi.spyOn(viewport, 'getBoundingClientRect');
  const measureSlot = vi.spyOn(slot, 'getBoundingClientRect');
  measureViewport.mockReturnValue(new DOMRect(0, 104, 384, 440));
  measureSlot.mockReturnValue(new DOMRect(198, 230, 170, 170));
  rerender(<Harness />);
  expect(layer.style.top).toBe('44px');
  expect(layer.style.getPropertyValue('--note-top')).toBe('126px');
  expect(layer.style.getPropertyValue('--note-width')).toBe('170px');

  measureViewport.mockReturnValue(new DOMRect(0, 120, 320, 300));
  measureSlot.mockReturnValue(new DOMRect(150, 100, 146, 146));
  rerender(<Harness />);
  expect(layer.style.top).toBe('60px');
  expect(layer.style.right).toBe('52px');
  expect(layer.style.getPropertyValue('--note-top')).toBe('-20px');
  expect(layer.style.getPropertyValue('--note-width')).toBe('146px');
  expect(layer.style.getPropertyValue('--note-expanded-height')).toBe('360px');
});
