// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import Dexie from 'dexie';
import { KonstaProvider } from 'konsta/react';
import { afterEach, expect, it, vi } from 'vitest';
import { directMediaUrl } from '../media/directMediaUpload';
import { readDiscussionMedia, storeDiscussionMedia } from '../media/discussionMediaCache';
import { DiscussionMedia } from './DiscussionMedia';

const accountId = 'tg:8172';
const photo = new Blob(['photo'], { type: 'image/jpeg' });
const video = new Blob(['video'], { type: 'video/mp4' });
const photoEntry = {
  accountId, storageKey: 'mvp-media/' + 'a'.repeat(64), mimeType: photo.type, sizeBytes: photo.size,
};
const videoEntry = {
  accountId, storageKey: 'mvp-media/' + 'b'.repeat(64), mimeType: video.type, sizeBytes: video.size,
};

class VisibleObserver implements IntersectionObserver {
  static current: VisibleObserver | undefined;
  readonly root = null;
  readonly rootMargin = '0px';
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

function setupBrowser() {
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
  await storeDiscussionMedia(photoEntry, photo);
  setupBrowser();
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

it('caches a visible video thumbnail and serves it locally on reopening', async () => {
  setupBrowser();
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
