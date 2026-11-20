// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import Dexie from 'dexie';
import { KonstaProvider } from 'konsta/react';
import { afterEach, expect, it, vi } from 'vitest';
import { directMediaUrl } from '../media/directMediaUpload';
import { readDiscussionMedia, storeDiscussionMedia } from '../media/discussionMediaCache';
import { DiscussionMedia } from './DiscussionMedia';

const accountId = 'tg:8172';
const photoEntry = {
  accountId, storageKey: 'mvp-media/' + 'a'.repeat(64), mimeType: 'image/jpeg', sizeBytes: 5,
};
const videoEntry = {
  accountId, storageKey: 'mvp-media/' + 'b'.repeat(64), mimeType: 'video/mp4', sizeBytes: 5,
};

class VisibleObserver implements IntersectionObserver {
  static current: VisibleObserver | undefined;
  readonly root = null;
  readonly rootMargin = '0px';
  readonly scrollMargin = '0px';
  readonly thresholds = [0];

  constructor(private readonly callback: IntersectionObserverCallback) {
    VisibleObserver.current = this;
  }

  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords(): IntersectionObserverEntry[] { return []; }

  enter(target: Element) {
    const rect = target.getBoundingClientRect();
    this.callback([{
      target, isIntersecting: true, intersectionRatio: 1, boundingClientRect: rect,
      intersectionRect: rect, rootBounds: null, time: 0,
    }], this);
  }
}

function visible(container: HTMLElement) {
  act(() => {
    const observer = VisibleObserver.current;
    if (!observer) throw new Error('No lazy media observer');
    observer.enter(container.firstElementChild ?? container);
  });
}

async function setupBrowser() {
  // Response creates a native Blob compatible with streaming and IndexedDB cloning,
  // unlike jsdom's Blob. Derive its constructor without requiring Node type packages.
  const nativeBlob = await new Response('fixture').blob();
  vi.stubGlobal('Blob', nativeBlob.constructor);
  vi.stubGlobal('IntersectionObserver', VisibleObserver);
  vi.stubGlobal('URL', class extends URL {
    static createObjectURL = vi.fn(() => 'blob:cached-attachment');
    static revokeObjectURL = vi.fn();
  });
}

afterEach(async () => {
  cleanup();
  vi.unstubAllGlobals();
  VisibleObserver.current = undefined;
  await Dexie.delete(`mezfit-discussion-media:${accountId}`);
});

it('reads a cached photo from IndexedDB before requesting Yandex', async () => {
  await setupBrowser();
  await storeDiscussionMedia(photoEntry, new Blob(['photo'], { type: photoEntry.mimeType }));
  const get = vi.fn<typeof fetch>();
  vi.stubGlobal('fetch', get);

  const { container } = render(<KonstaProvider theme="ios" dark>
    <DiscussionMedia src={directMediaUrl(photoEntry.storageKey) ?? ''} type="photo"
      cache={photoEntry} mode="thumbnail" />
  </KonstaProvider>);
  visible(container);
  await waitFor(() => expect(container.querySelector('img')?.getAttribute('src')).toBe('blob:cached-attachment'));
  expect(get).not.toHaveBeenCalled();
});

it('downloads Full for the photo viewer without persisting the original', async () => {
  await setupBrowser();
  const path = 'mvp-media/' + 'a'.repeat(64);
  const photoId = 'b'.repeat(64);
  const full = { ...photoEntry, storageKey: `${path}/full/${photoId}` };
  const preview = { ...photoEntry, storageKey: `${path}/preview/${photoId}` };
  await storeDiscussionMedia(preview, new Blob(['small'], { type: preview.mimeType }), true);
  const get = vi.fn<typeof fetch>().mockResolvedValue(new Response(
    new Blob(['photo'], { type: full.mimeType }), { headers: { 'Content-Type': full.mimeType } },
  ));
  vi.stubGlobal('fetch', get);
  const src = directMediaUrl(full.storageKey) ?? '';
  const { container, unmount } = render(<KonstaProvider theme="ios" dark>
    <DiscussionMedia src={src} type="photo" cache={full} mode="viewer" />
  </KonstaProvider>);
  await waitFor(() => expect(container.querySelector('img')?.getAttribute('src')).toBe('blob:cached-attachment'));
  expect(get).toHaveBeenCalledExactlyOnceWith(src, expect.anything());
  expect(await readDiscussionMedia(full)).toBeNull();
  expect(await (await readDiscussionMedia(preview))?.text()).toBe('small');
  unmount();
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:cached-attachment');
});

it('requires a valid local copy for an outgoing video and reads it back from IndexedDB', async () => {
  await setupBrowser();
  const video = new Blob(['video'], { type: videoEntry.mimeType });
  await expect(storeDiscussionMedia({ ...videoEntry, sizeBytes: video.size + 1 }, video, true))
    .rejects.toThrow('INVALID_LOCAL_MEDIA');
  expect(await readDiscussionMedia(videoEntry)).toBeNull();
  await storeDiscussionMedia(videoEntry, video, true);
  expect(await (await readDiscussionMedia(videoEntry))?.text()).toBe('video');
});

it('keeps the cached preview when Full fails to decode and replaces it after a successful retry', async () => {
  await setupBrowser();
  const path = 'mvp-media/' + 'd'.repeat(64);
  const id = 'e'.repeat(64);
  const full = { ...photoEntry, storageKey: `${path}/full/${id}` };
  const preview = { ...photoEntry, storageKey: `${path}/preview/${id}` };
  const fullSrc = directMediaUrl(full.storageKey) ?? '';
  const previewSrc = directMediaUrl(preview.storageKey) ?? '';
  await storeDiscussionMedia(preview, new Blob(['small'], { type: preview.mimeType }), true);
  const get = vi.fn<typeof fetch>().mockImplementation(async () => new Response(
    new Blob(['photo'], { type: full.mimeType }), { headers: { 'Content-Type': full.mimeType } },
  ));
  vi.stubGlobal('fetch', get);
  const annotate = vi.fn();

  const view = render(<KonstaProvider theme="ios" dark>
    <DiscussionMedia src={fullSrc} type="photo" cache={full} mode="viewer"
      photoPreview={{ src: previewSrc, cache: preview }} onAnnotate={annotate} />
  </KonstaProvider>);
  const thumbnail = await view.findByAltText('Миниатюра фото');
  fireEvent.load(thumbnail);
  expect(thumbnail.style.visibility).toBe('visible');
  const original = await view.findByAltText('Фото во вложении');
  expect(original.style.visibility).toBe('hidden');
  fireEvent.error(original);
  await view.findByText('Не удалось открыть оригинал фото. Код PHOTO-FULL-DECODE');
  expect(view.getByAltText('Миниатюра фото')).toBe(thumbnail);
  expect(view.queryByRole('button', { name: 'Рисовать на изображении' })).toBeNull();

  fireEvent.click(view.getByRole('button', { name: 'Повторить' }));
  fireEvent.load(await view.findByAltText('Фото во вложении'));
  expect(view.queryByAltText('Миниатюра фото')).toBeNull();
  expect(view.queryByRole('status')).toBeNull();
  expect(view.getByRole('button', { name: 'Рисовать на изображении' })).toBeTruthy();
  expect(get.mock.calls.map(([url]) => url)).toEqual([fullSrc, fullSrc]);
  expect(await readDiscussionMedia(full)).toBeNull();
});

it('caches a visible video thumbnail and serves it locally on reopening', async () => {
  await setupBrowser();
  const video = new Blob(['video'], { type: videoEntry.mimeType });
  const get = vi.fn<typeof fetch>().mockResolvedValue(
    new Response(video, { status: 200, headers: { 'Content-Type': video.type, 'Content-Length': String(video.size) } }),
  );
  vi.stubGlobal('fetch', get);
  const src = directMediaUrl(videoEntry.storageKey) ?? '';

  const first = render(<KonstaProvider theme="ios" dark>
    <DiscussionMedia src={src} type="video" cache={videoEntry} mode="thumbnail" />
  </KonstaProvider>);
  expect(get).not.toHaveBeenCalled();
  visible(first.container);
  await waitFor(() => expect(get).toHaveBeenCalledTimes(1));
  await waitFor(async () => expect(await readDiscussionMedia(videoEntry)).not.toBeNull());
  expect(first.container.querySelector('video')?.getAttribute('src')).toBe(src);
  first.unmount();

  const second = render(<KonstaProvider theme="ios" dark>
    <DiscussionMedia src={src} type="video" cache={videoEntry} mode="thumbnail" />
  </KonstaProvider>);
  visible(second.container);
  await waitFor(() => expect(second.container.querySelector('video')?.getAttribute('src')).toBe('blob:cached-attachment'));
  expect(get).toHaveBeenCalledTimes(1);
});

it('does not preload a large video until the viewer is opened', async () => {
  await setupBrowser();
  const video = new Blob(['video'], { type: videoEntry.mimeType });
  const get = vi.fn<typeof fetch>().mockResolvedValue(
    new Response(video, { status: 200, headers: { 'Content-Type': video.type } }),
  );
  vi.stubGlobal('fetch', get);
  const largeEntry = { ...videoEntry, storageKey: 'mvp-media/' + 'c'.repeat(64), sizeBytes: 9 * 1024 * 1024 };
  const src = directMediaUrl(largeEntry.storageKey) ?? '';

  const thumbnail = render(<KonstaProvider theme="ios" dark>
    <DiscussionMedia src={src} type="video" cache={largeEntry} mode="thumbnail" />
  </KonstaProvider>);
  visible(thumbnail.container);
  await waitFor(() => expect(thumbnail.container.querySelector('video')?.getAttribute('src')).toBe(src));
  expect(get).not.toHaveBeenCalled();
  thumbnail.unmount();

  render(<KonstaProvider theme="ios" dark>
    <DiscussionMedia src={src} type="video" cache={largeEntry} mode="viewer" />
  </KonstaProvider>);
  await waitFor(() => expect(get).toHaveBeenCalledTimes(1));
});

it('offers retry for a failed Full request and keeps the cached preview visible', async () => {
  await setupBrowser();
  const path = 'mvp-media/' + 'e'.repeat(64);
  const id = 'f'.repeat(64);
  const full = { ...photoEntry, storageKey: `${path}/full/${id}` };
  const preview = { ...photoEntry, storageKey: `${path}/preview/${id}` };
  const fullSrc = directMediaUrl(full.storageKey) ?? '';
  const previewSrc = directMediaUrl(preview.storageKey) ?? '';
  await storeDiscussionMedia(preview, new Blob(['small'], { type: preview.mimeType }), true);
  const get = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 503 }));
  vi.stubGlobal('fetch', get);

  const view = render(<KonstaProvider theme="ios" dark>
    <DiscussionMedia src={fullSrc} type="photo" cache={full} mode="viewer"
      photoPreview={{ src: previewSrc, cache: preview }} />
  </KonstaProvider>);
  const thumbnail = await view.findByAltText('Миниатюра фото');
  fireEvent.load(thumbnail);
  await view.findByText('Не удалось открыть оригинал фото. Код PHOTO-FULL-LOAD');
  expect(thumbnail.style.visibility).toBe('visible');
  expect(view.queryByAltText('Фото во вложении')).toBeNull();
  expect(view.getByRole('button', { name: 'Повторить' })).toBeTruthy();
  expect(get).toHaveBeenCalledExactlyOnceWith(fullSrc, expect.anything());
});
