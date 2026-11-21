// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { KonstaProvider } from 'konsta/react';
import { afterEach, expect, it, vi } from 'vitest';
import { DiscussionMedia } from './DiscussionMedia';
import { DiscussionVideoNote } from './DiscussionVideoNote';

const full = 'https://media.example/full/video-id';
const preview = 'https://media.example/preview/video-id';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it('renders a static video cover in chat and opens the viewer only on activation', () => {
  const open = vi.fn();
  const { container } = render(<KonstaProvider theme="ios" dark>
    <DiscussionMedia src={full} mode="thumbnail" type="video" durationSeconds={17} videoPreview={{ src: preview }} onOpen={open} />
  </KonstaProvider>);
  expect(container.querySelector('video')).toBeNull();
  expect(screen.getByAltText('Обложка видео').getAttribute('src')).toBe(preview);
  expect(screen.getByText('0:17')).toBeTruthy();
  expect(open).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('link', { name: 'Открыть видео' }));
  expect(open).toHaveBeenCalledOnce();
});

it('attaches video-note Full in the opening gesture and detaches it on collapse', () => {
  const playedSources: Array<string | null> = [];
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(function (this: HTMLMediaElement) {
    playedSources.push(this.getAttribute('src'));
    return Promise.resolve();
  });
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  const load = vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
  render(<DiscussionVideoNote src={full} durationSeconds={17} preview={{ src: preview }} />);
  const video = screen.getByLabelText('Записанный видеокружок');
  expect(video.getAttribute('src')).toBeNull();
  expect(screen.getByAltText('Обложка видеокружка').getAttribute('src')).toBe(preview);
  fireEvent.click(screen.getByRole('button', { name: 'Открыть видеокружок' }));
  expect(playedSources).toEqual([full]);
  expect(video.getAttribute('src')).toBe(full);
  fireEvent.pointerDown(document.body);
  expect(video.getAttribute('src')).toBeNull();
  expect(load).toHaveBeenCalledOnce();
  expect(screen.getByAltText('Обложка видеокружка')).toBeTruthy();
});
