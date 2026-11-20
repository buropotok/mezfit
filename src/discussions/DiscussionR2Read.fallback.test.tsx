// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import Dexie from 'dexie';
import { KonstaProvider } from 'konsta/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { setDiscussionMediaBackupEnabled } from '../media/discussionMediaBackupPreference';
import { directMediaUrl } from '../media/directMediaUpload';
import { readDiscussionMedia, downloadDiscussionMedia, downloadDiscussionMediaWithStatus } from '../media/discussionMediaCache';
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

beforeEach(() => { setDiscussionMediaBackupEnabled(true); });

afterEach(async () => {
  cleanup();
  localStorage.clear();
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

it('switches native video Range playback to the signed R2 URL with backup off', async () => {
  setDiscussionMediaBackupEnabled(false);
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

it.each([
  [404, 200, 'R2-SIGN-404'],
  [200, 403, 'R2-GET-403'],
  [200, 200, 'R2-SIZE'],
] as const)('shows the Full error code for signer %i and storage %i on the viewer', async (signStatus, getStatus, code) => {
  await browserBlob();
  const fullKey = `mvp-media/${'d'.repeat(64)}/full/${'e'.repeat(64)}`;
  const full = { ...entry, storageKey: fullKey, attachmentId: 'e'.repeat(64) };
  const fullSrc = directMediaUrl(fullKey) ?? '';
  const signedSrc = getUrl.replace(key, fullKey);
  const transport = vi.fn<typeof fetch>(async url => {
    if (url === fullSrc) return new Response(null, { status: 404 });
    if (url === '/api/discussion-media/read') return signStatus === 200
      ? Response.json({ storageKey: fullKey, getUrl: signedSrc, expiresAt: Date.now() + 600_000 })
      : Response.json({ error: { code: 'MEDIA_NOT_FOUND' } }, { status: signStatus });
    if (url === signedSrc) return new Response('x', { status: getStatus, headers: { 'Content-Type': full.mimeType } });
    throw new Error('Unexpected URL');
  });
  vi.stubGlobal('fetch', transport);

  const view = render(<KonstaProvider theme="ios" dark>
    <DiscussionMedia src={fullSrc} type="photo" cache={full} mode="viewer"
      photoPreview={{ src: 'blob:preview' }} />
  </KonstaProvider>);
  await view.findByText(`Не удалось открыть оригинал фото. Код ${code}`);
  expect(view.getByRole('button', { name: 'Повторить' })).toBeTruthy();
  expect(transport.mock.calls.map(([url]) => url)).toEqual(
    signStatus === 200 ? [fullSrc, '/api/discussion-media/read', signedSrc] : [fullSrc, '/api/discussion-media/read'],
  );
});

it.each([true, false])('validates and joins ranges after a broken R2 body (valid first range: %s)', async valid => {
  await browserBlob();
  const chunkSize = 1024 * 1024;
  const sizeBytes = chunkSize + 3;
  const fullKey = `mvp-media/${'f'.repeat(64)}/full/${'a'.repeat(64)}`;
  const full = { ...entry, storageKey: fullKey, attachmentId: 'a'.repeat(64), sizeBytes };
  const signedSrc = getUrl.replace(key, fullKey);
  const ranges: string[] = [];
  const transport = vi.fn<typeof fetch>(async (url, options) => {
    if (url === directMediaUrl(fullKey)) return new Response(null, { status: 404 });
    if (url === '/api/discussion-media/read') {
      return Response.json({ storageKey: fullKey, getUrl: signedSrc, expiresAt: Date.now() + 600_000 });
    }
    if (url !== signedSrc) throw new Error('Unexpected URL');
    const range = new Headers(options?.headers).get('range');
    if (range === null) {
      const body = new ReadableStream({ start(controller) { controller.error(new TypeError('Connection reset')); } });
      return new Response(body, { headers: { 'Content-Type': full.mimeType, 'Content-Length': String(sizeBytes) } });
    }
    ranges.push(range);
    const first = range === `bytes=0-${chunkSize - 1}`;
    const body = first ? new Uint8Array(chunkSize).fill(7) : Uint8Array.of(8, 9, 10);
    const contentRange = first
      ? `bytes ${valid ? '0' : '1'}-${chunkSize - 1}/${sizeBytes}`
      : `bytes ${chunkSize}-${sizeBytes - 1}/${sizeBytes}`;
    return new Response(body, {
      status: 206, headers: { 'Content-Type': full.mimeType, 'Content-Range': contentRange },
    });
  });
  vi.stubGlobal('fetch', transport);

  const result = await downloadDiscussionMediaWithStatus(full);
  expect(ranges).toEqual(valid
    ? [`bytes=0-${chunkSize - 1}`, `bytes=${chunkSize}-${sizeBytes - 1}`]
    : [`bytes=0-${chunkSize - 1}`]);
  if (valid) {
    expect(result.blob?.size).toBe(sizeBytes);
    expect(new Uint8Array(await result.blob?.slice(chunkSize - 1).arrayBuffer() ?? new ArrayBuffer(0)))
      .toEqual(Uint8Array.of(7, 8, 9, 10));
    expect(result.r2Failure).toBeUndefined();
  } else {
    expect(result.blob).toBeNull();
    expect(result.r2Failure).toBe('R2-RANGE-INVALID');
  }
  expect(await readDiscussionMedia(full)).toBeNull();
});
