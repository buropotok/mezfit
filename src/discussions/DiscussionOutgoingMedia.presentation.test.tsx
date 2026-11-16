// @vitest-environment jsdom
import { useRef, useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { KonstaProvider } from 'konsta/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { DiscussionMediaDraft } from '../data/cloud/discussion-media';
import { DiscussionOutgoingMedia } from './DiscussionOutgoingMedia';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const createdAt = '2026-11-16T10:04:00.000Z';
const circle: DiscussionMediaDraft = {
  id: 'circle', storageKey: 'mvp-media/' + 'a'.repeat(64), mediaType: 'video-note',
  mimeType: 'video/mp4', sizeBytes: 16, durationSeconds: 3,
  fileName: 'Кружок.mp4', uploadState: 'failed',
};
const voice: DiscussionMediaDraft = {
  id: 'voice', storageKey: 'mvp-media/' + 'b'.repeat(64), mediaType: 'voice',
  mimeType: 'audio/mp4', sizeBytes: 16, durationSeconds: 3, waveform: [0.2, 0.6],
  fileName: 'Голосовое.m4a', uploadState: 'failed',
};

function FailedCircleHarness() {
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  return <KonstaProvider theme="ios" dark>
    <div className="discussion-thread__scroll" ref={scroller}>
      <div className="discussion-message-target discussion-message-target--outgoing" data-own="true">
        <DiscussionOutgoingMedia src="blob:failed-circle" attachment={circle} createdAt={createdAt} status="failed"
          playbackHost={host} scrollViewport={scroller}
          onCancel={vi.fn()} onRemove={vi.fn()} onRetry={vi.fn()} />
      </div>
      <div className="discussion-video-note-playback" ref={setHost} data-testid="shared-playback-host" />
    </div>
  </KonstaProvider>;
}

it('keeps an unsent circle at the outgoing edge while expanding through the shared video-note host', () => {
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
  const view = render(<FailedCircleHarness />);
  const outgoing = view.container.querySelector('.discussion-message-target--outgoing');
  const circleSlot = outgoing?.querySelector('.discussion-outgoing__preview--circle');
  const host = screen.getByTestId('shared-playback-host');
  const video = screen.getByLabelText('Записанный видеокружок');

  expect(circleSlot).toBeTruthy();
  expect(outgoing?.getAttribute('data-own')).toBe('true');
  expect(circleSlot?.querySelector('.discussion-video-note')).toBeTruthy();
  expect(host.contains(video)).toBe(true);
  expect(screen.getByRole('button', { name: 'Ещё раз' })).toBeTruthy();

  fireEvent.click(screen.getByRole('button', { name: 'Открыть видеокружок' }));
  expect(host.querySelector('.discussion-video-note__layer[data-expanded]')).toBeTruthy();
  expect(screen.getByRole('slider', { name: 'Перемотка видеокружка' })).toBeTruthy();
  expect(host.contains(video)).toBe(true);
  expect(screen.getByLabelText('Записанный видеокружок')).toBe(video);

  fireEvent.pointerDown(document.body);
  expect(screen.getByRole('button', { name: 'Открыть видеокружок' })).toBeTruthy();
});

it('uses the exact same UI Kit circular background for voice upload cancellation as for Play', () => {
  const cancel = vi.fn();
  const sending = render(<KonstaProvider theme="ios" dark>
    <DiscussionOutgoingMedia src="blob:voice" attachment={voice} createdAt={createdAt} status="uploading"
      onCancel={cancel} onRemove={vi.fn()} onRetry={vi.fn()} />
  </KonstaProvider>);
  const stopButton = screen.getByRole('button', { name: 'Отменить загрузку' });
  expect(stopButton.getAttribute('data-ui-theme')).toBe('default');
  expect(stopButton.getAttribute('data-selected')).toBe('true');
  expect(stopButton.classList.contains('ui-icon-button--color-gray')).toBe(true);
  expect(stopButton.classList.contains('ui-icon-button--selected')).toBe(true);
  expect(sending.container.querySelector('.discussion-outgoing__cancel')).toBeNull();
  fireEvent.click(stopButton);
  expect(cancel).toHaveBeenCalledOnce();
  sending.unmount();

  render(<KonstaProvider theme="ios" dark>
    <DiscussionOutgoingMedia src="blob:voice" attachment={voice} createdAt={createdAt} status="failed"
      onCancel={vi.fn()} onRemove={vi.fn()} onRetry={vi.fn()} />
  </KonstaProvider>);
  const play = screen.getByRole('button', { name: 'Воспроизвести голосовое сообщение' });
  expect(play.getAttribute('data-ui-theme')).toBe(stopButton.getAttribute('data-ui-theme'));
  expect(play.classList.contains('ui-icon-button--color-gray')).toBe(true);
  expect(play.classList.contains('ui-icon-button--selected')).toBe(true);
});
