// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { uploadMirroredDiscussionMedia, acceptMediaReplica, resumeMediaReplicaUploads } from './dualMediaUpload';
import { uploadDirectMedia, MediaUploadError } from './directMediaUpload';
import { uploadCloudflareMedia } from './cloudflareMediaUpload';
import { listIncompleteMediaReplicas, readDiscussionMedia, confirmMediaReplica, publishMediaReplica } from './discussionMediaCache';

vi.mock('./directMediaUpload', async original => ({
  ...await original<typeof import('./directMediaUpload')>(),
  uploadDirectMedia: vi.fn(),
}));
vi.mock('./cloudflareMediaUpload', () => ({ uploadCloudflareMedia: vi.fn() }));
vi.mock('./discussionMediaCache', async original => ({
  ...await original<typeof import('./discussionMediaCache')>(),
  rememberMediaReplica: vi.fn(async () => undefined),
  confirmMediaReplica: vi.fn(async () => undefined),
  publishMediaReplica: vi.fn(async () => undefined),
  listIncompleteMediaReplicas: vi.fn(async () => []),
  readDiscussionMedia: vi.fn(async () => null),
}));

const key = 'mvp-media/' + 'a'.repeat(64);
const accountId = 'tg:42';
const file = () => new File(['sample'], 'photo.jpg', { type: 'image/jpeg' });
const uploaded = { key, url: 'https://storage.yandexcloud.net/bucket/' + key, fileName: 'photo.jpg',
  contentType: 'image/jpeg', sizeBytes: 6 };

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

it('confirms Yandex and publishes immediately while R2 copy is still pending', async () => {
  let completeR2: ((value: typeof uploaded) => void) | undefined;
  vi.mocked(uploadDirectMedia).mockResolvedValue(uploaded);
  vi.mocked(uploadCloudflareMedia).mockImplementation(() => new Promise(resolve => { completeR2 = resolve; }));
  await expect(uploadMirroredDiscussionMedia(file(), { accountId, retryKey: key })).resolves.toEqual(uploaded);
  expect(uploadDirectMedia).toHaveBeenCalledOnce();
  expect(uploadCloudflareMedia).toHaveBeenCalledOnce();
  expect(confirmMediaReplica).toHaveBeenCalledWith(accountId, key, 'yandex');
  expect(confirmMediaReplica).not.toHaveBeenCalledWith(accountId, key, 'r2');
  completeR2?.(uploaded);
  await vi.waitFor(() => expect(confirmMediaReplica).toHaveBeenCalledWith(accountId, key, 'r2'));
});

it('falls back to R2 when Yandex cannot be reached, without generating a second key', async () => {
  vi.mocked(uploadDirectMedia).mockRejectedValue(new MediaUploadError('NETWORK', undefined, undefined, undefined, 'signer'));
  vi.mocked(uploadCloudflareMedia).mockResolvedValue(uploaded);
  await expect(uploadMirroredDiscussionMedia(file(), { accountId, retryKey: key })).resolves.toEqual(uploaded);
  expect(uploadCloudflareMedia).toHaveBeenCalledWith(expect.any(File), { retryKey: key, signal: undefined });
  expect(confirmMediaReplica).toHaveBeenCalledWith(accountId, key, 'r2');
  expect(confirmMediaReplica).not.toHaveBeenCalledWith(accountId, key, 'yandex');
});

it('keeps a failed upload retryable when both providers reject it', async () => {
  vi.mocked(uploadDirectMedia).mockRejectedValue(new MediaUploadError('NETWORK'));
  vi.mocked(uploadCloudflareMedia).mockRejectedValue(new MediaUploadError('HTTP', 503));
  await expect(uploadMirroredDiscussionMedia(file(), { accountId, retryKey: key })).rejects.toMatchObject({ code: 'HTTP', status: 503 });
  expect(confirmMediaReplica).not.toHaveBeenCalled();
});

it('does not attempt R2 when the user has cancelled an active Yandex upload', async () => {
  const controller = new AbortController();
  controller.abort();
  await expect(uploadMirroredDiscussionMedia(file(), { accountId, retryKey: key, signal: controller.signal }))
    .rejects.toMatchObject({ code: 'CANCELLED' });
  expect(uploadDirectMedia).not.toHaveBeenCalled();
  expect(uploadCloudflareMedia).not.toHaveBeenCalled();
});

it('recovers only missing providers for accepted attachments in later sessions', async () => {
  const pending = { accountId, storageKey: key, mimeType: 'image/jpeg', sizeBytes: 6,
    fileName: 'photo.jpg', published: true, r2ConfirmedAt: '2026-11-15T12:00:00.000Z' };
  vi.mocked(listIncompleteMediaReplicas).mockResolvedValue([pending]);
  vi.mocked(readDiscussionMedia).mockResolvedValue(new Blob(['sample'], { type: 'image/jpeg' }));
  vi.mocked(uploadDirectMedia).mockResolvedValue(uploaded);
  await acceptMediaReplica(accountId, key);
  await resumeMediaReplicaUploads(accountId);
  expect(publishMediaReplica).toHaveBeenCalledWith(accountId, key);
  expect(uploadDirectMedia).toHaveBeenCalledWith(expect.any(File), { retryKey: key });
  expect(uploadCloudflareMedia).not.toHaveBeenCalled();
  expect(confirmMediaReplica).toHaveBeenCalledWith(accountId, key, 'yandex');
});


it('starts R2 after eight seconds when Yandex is still waiting and accepts the first success', async () => {
  vi.useFakeTimers();
  vi.mocked(uploadDirectMedia).mockImplementation(() => new Promise<Awaited<ReturnType<typeof uploadDirectMedia>>>(() => undefined));
  vi.mocked(uploadCloudflareMedia).mockResolvedValue(uploaded);
  const result = uploadMirroredDiscussionMedia(file(), { accountId, retryKey: key });
  await vi.advanceTimersByTimeAsync(0);
  expect(uploadCloudflareMedia).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(8_000);
  await expect(result).resolves.toMatchObject({ key });
  expect(uploadDirectMedia).toHaveBeenCalledOnce();
  expect(uploadCloudflareMedia).toHaveBeenCalledOnce();
});
