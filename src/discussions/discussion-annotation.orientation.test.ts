// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { copyAnnotationImage } from './discussion-annotation';

afterEach(() => vi.restoreAllMocks());

it('copies the compensated orientation into the annotation image', () => {
  const context = { translate: vi.fn(), rotate: vi.fn(), drawImage: vi.fn(), getImageData: vi.fn() };
  // Only the canvas boundary is simulated; pixel rotation is owned by the browser canvas API.
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => null);
  Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', { configurable: true, value: () => context });
  const video = document.createElement('video');
  Object.defineProperties(video, { videoWidth: { value: 480 }, videoHeight: { value: 488 } });
  const image = copyAnnotationImage(video, 90);
  expect([image.width, image.height]).toEqual([488, 480]);
  expect(context.translate).toHaveBeenCalledWith(244, 240);
  expect(context.rotate).toHaveBeenCalledWith(Math.PI / 2);
  expect(context.drawImage).toHaveBeenCalledWith(video, -240, -244, 480, 488);
});
