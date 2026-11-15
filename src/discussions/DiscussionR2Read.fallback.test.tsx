// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import Dexie from 'dexie';
import { KonstaProvider } from 'konsta/react';
import { afterEach, expect, it, vi } from 'vitest';
import { directMediaUrl } from '../media/directMediaUpload';
import { readDiscussionMedia, downloadDiscussionMedia } from '../media/discussionMediaCache';
import { rawInitData } from '../media/mediaUploadTestFixtures';
import { DiscussionMedia } from './DiscussionMedia';
import { DiscussionVoice } from './DiscussionVoice';

const accountId = 'tg:12001';
const key = 'mvp-media/' + 'd'.repeat(64);
const entry = { accountId, storageKey: key, mimeType: 'image/jpeg', sizeBytes: 5,
  realmId: 'rlm' + 'a'.repeat(28), messageId: '22222222-2222-4222-8222-222222222222', attachmentId: '33333333-3333-4333-8333-333333333333' };
const readHost = 'mezfit-discussion-media.' + 'a'.repeat(32) + '.r2.cloudflarestorage.com';
const getUrl = `https://${readHost}/${key}?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-SignedHeaders=host&X-Amz-Signature=${'b'.repeat(64)}`;
const yandexUrl = directMediaUrl(key) ?? '';

afterEach(async () => {
  cleanup();
  vi.unstubAllGlobals();
  await Dexie.delete('mezfit-discussion-media:' + accountId);
});

async function browserBlob() {
  const original = await new Response('fixture').blob();
  vi.stubGlobal('Blob', original.constructor);
  vi.stubGlobal('Telegram', { WebApp: { initData: rawInitData } });
}

it('downloads a failed Yandex photograph from R2, checks bytes and caches the replica locally', async () => {
  await browserBlob();
  const blob = new Blob(['photo'], { type: 'image/jpeg' });
  const transport = vi.fn<typeof fetch>(async url => {
    if (url === yandexUrl) return new Response(null, { status: 404 });
    if (url === '/api/discussion-media/read') return Response.json({
      storageKey: key, getUrl, expiresAt: Date.now() + 600_000,
    });
    if (url === getUrl) return new Response(blob, { status: 200,
      headers: { 'Content-Type': 'image/jpeg', 'Content-Length': '5' } });
    throw new Error('Unexpected URL: ' + url);
  });
  vi.stubGlobal('fetch', transport);
  expect(await (await downloadDiscussionMedia(entry))?.text()).toBe('photo');
  expect(await (await readDiscussionMedia(entry))?.text()).toBe('photo');
  expect(transport.mock.calls.map(([url]) => url)).toEqual([yandexUrl, '/api/discussion-media/read', getUrl]);
});

it('does not bypass the Worker when R2 access is refused', async () => {
  await browserBlob();
  const transport = vi.fn<typeof fetch>(async url =>
    url === yandexUrl ? new Response(null, { status: 404 })
      : new Response(null, { status: 403 }));
  vi.stubGlobal('fetch', transport);
  expect(await downloadDiscussionMedia(entry)).toBeNull();
  expect(await readDiscussionMedia(entry)).toBeNull();
  expect(transport).toHaveBeenCalledTimes(2);
});

it('switches native video Range playback to the signed R2 URL without a full-video download', async () => {
  await browserBlob();
  const transport = vi.fn<typeof fetch>(async url => {
    if (url === '/api/discussion-media/read') return Response.json({
      storageKey: key, getUrl, expiresAt: Date.now() + 600_000,
    });
    throw new Error('Full file fetching must not start for a large video thumbnail: ' + url);
  });
  vi.stubGlobal('fetch', transport);
  const videoEntry = { ...entry, mimeType: 'video/mp4', sizeBytes: 9 * 1024 * 1024 };
  const view = render(<KonstaProvider theme="ios" dark>
    <DiscussionMedia src={yandexUrl} type="video" cache={videoEntry} mode="thumbnail" />
  </KonstaProvider>);
  await waitFor(() => expect(view.container.querySelector('video')?.getAttribute('src')).toBe(yandexUrl));
  const video = view.container.querySelector('video');
  if (!video) throw new Error('video not rendered');
  fireEvent.error(video);
  await waitFor(() => expect(view.container.querySelector('video')?.getAttribute('src')).toBe(getUrl));
  expect(transport).toHaveBeenCalledTimes(1);
});

it('switches a failed voice message to the private R2 source', async () => {
  await browserBlob();
  const transport = vi.fn<typeof fetch>(async url => {
    if (url === '/api/discussion-media/read') return Response.json({
      storageKey: key, getUrl, expiresAt: Date.now() + 600_000,
    });
    throw new Error('An audio player must use native streaming rather than a full-file fetch: ' + url);
  });
  vi.stubGlobal('fetch', transport);
  const voiceEntry = { ...entry, mimeType: 'audio/ogg', sizeBytes: 5 };
  const view = render(<KonstaProvider theme="ios" dark>
    <DiscussionVoice src={yandexUrl} cache={voiceEntry} waveform={[]} durationMs={1_000} />
  </KonstaProvider>);
  await waitFor(() => expect(view.container.querySelector('audio')?.getAttribute('src')).toBe(yandexUrl));
  const audio = view.container.querySelector('audio');
  if (!audio) throw new Error('voice audio not rendered');
  fireEvent.error(audio);
  await waitFor(() => expect(view.container.querySelector('audio')?.getAttribute('src')).toBe(getUrl));
  expect(transport).toHaveBeenCalledTimes(1);
});
