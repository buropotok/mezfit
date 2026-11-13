// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { DiscussionVideoReview } from './DiscussionVideoReview';

vi.mock('../media/videoTrim', () => ({
  MIN_VIDEO_TRIM_SECONDS: 0.2,
  inspectVideoTrim: async () => ({ duration: 12, timelineStart: 0 }),
  trimRecordedMp4: vi.fn(),
}));
vi.mock('./useVideoTrimFilmstrip', () => ({
  VIDEO_TRIM_FRAME_COUNT: 8,
  useVideoTrimFilmstrip: () => [],
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function openReview() {
  vi.stubGlobal('URL', Object.assign(class extends URL {}, {
    createObjectURL: () => 'blob:recording',
    revokeObjectURL: () => {},
  }));
  render(<DiscussionVideoReview
    clip={{ blob: new Blob(), mimeType: 'video/mp4', durationMs: 12000 }}
    onUse={() => {}} onRetake={() => {}} confirmStyle={{}} retakeStyle={{}}
  />);
  const start = await screen.findByRole('slider', { name: 'Начало отрезка' });
  const video = screen.getByLabelText('Предпросмотр записи');
  if (!(video instanceof HTMLVideoElement)) throw new Error('Missing video preview');

  let seeking = false;
  let time = 0;
  vi.spyOn(video, 'seeking', 'get').mockImplementation(() => seeking);
  vi.spyOn(video, 'currentTime', 'get').mockImplementation(() => time);
  vi.spyOn(video, 'currentTime', 'set').mockImplementation(value => { time = value; seeking = true; });
  const pause = vi.spyOn(video, 'pause').mockImplementation(() => {});
  const play = vi.spyOn(video, 'play').mockResolvedValue();

  const completeSeek = () => {
    seeking = false;
    fireEvent.seeked(video);
  };
  return { start, video, play, pause, completeSeek };
}

it('starts only when the seek to the selected start has finished', async () => {
  const { start, video, play, pause, completeSeek } = await openReview();
  expect(video.controls).toBe(true);
  fireEvent.change(start, { target: { value: '4.5' } });
  expect(video.controls).toBe(true);
  expect(screen.queryByRole('button', { name: 'Воспроизвести отрезок' })).toBeNull();
  expect(video.currentTime).toBe(4.5);
  pause.mockClear();
  fireEvent.play(video);
  expect(pause).toHaveBeenCalledOnce();
  expect(play).not.toHaveBeenCalled();
  completeSeek();
  expect(play).toHaveBeenCalledOnce();
});

it('cancels a pending start when the trim boundary changes', async () => {
  const { start, video, play, completeSeek } = await openReview();
  fireEvent.change(start, { target: { value: '4.5' } });
  fireEvent.play(video);
  fireEvent.change(start, { target: { value: '5.5' } });
  completeSeek();
  expect(play).not.toHaveBeenCalled();
});

it('replays from the left boundary after seeking to the right boundary', async () => {
  const { start, video, play, completeSeek } = await openReview();
  fireEvent.change(start, { target: { value: '4.5' } });
  fireEvent.change(screen.getByRole('slider', { name: 'Конец отрезка' }), { target: { value: '9' } });
  completeSeek();
  expect(video.currentTime).toBe(9);
  fireEvent.play(video);
  expect(video.currentTime).toBe(4.5);
  expect(play).not.toHaveBeenCalled();
  completeSeek();
  expect(play).toHaveBeenCalledOnce();
});

it('lets native Play continue immediately within the selected range after seeking', async () => {
  const { start, video, play, pause, completeSeek } = await openReview();
  fireEvent.change(start, { target: { value: '4.5' } });
  completeSeek();
  pause.mockClear();
  fireEvent.play(video);
  expect(pause).not.toHaveBeenCalled();
  expect(play).not.toHaveBeenCalled();
});
