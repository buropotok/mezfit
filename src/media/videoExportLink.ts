import { discussionMediaObjectSizeLimit } from '../../shared/discussion-media-limits';
import { directMediaUrl } from './directMediaUpload';
import { prepareVideoExport } from './prepareVideoExport';

interface PublicVideoExport {
  storageKey: string;
  mimeType: string;
  sizeBytes: number;
  videoNote: boolean;
}

function publicVideoUrl({ storageKey, mimeType, sizeBytes }: PublicVideoExport): string | null {
  if (!mimeType.startsWith('video/') || !Number.isSafeInteger(sizeBytes) || sizeBytes < 1
    || sizeBytes > discussionMediaObjectSizeLimit(storageKey, mimeType)) return null;
  return directMediaUrl(storageKey);
}

export function videoExportBrowserUrl(origin: string, sourceUrl: string, source: PublicVideoExport): string | null {
  if (publicVideoUrl(source) !== sourceUrl) return null;
  const url = new URL('/video-export.html', origin);
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  const { storageKey, mimeType, sizeBytes, videoNote } = source;
  // Do not send storage keys to the web host as request URL or referrer data.
  url.hash = new URLSearchParams({ key: storageKey, mime: mimeType, size: String(sizeBytes),
    ...(videoNote ? { note: '1' } : {}) }).toString();
  return url.href;
}

export async function loadBrowserVideoExport(hash: string, signal: AbortSignal): Promise<File> {
  const params = new URLSearchParams(hash.slice(1));
  const source = { storageKey: params.get('key') ?? '', mimeType: params.get('mime') ?? '',
    sizeBytes: Number(params.get('size')), videoNote: params.get('note') === '1' };
  const url = publicVideoUrl(source);
  if (!url) throw new Error('VIDEO_EXPORT_LINK_INVALID');
  const response = await fetch(url, { signal, credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer' });
  const length = response.headers.get('content-length');
  if (response.status !== 200 || (length !== null && Number(length) !== source.sizeBytes)) {
    void response.body?.cancel().catch(() => undefined);
    throw new Error('VIDEO_EXPORT_INCOMPLETE');
  }
  const blob = await response.blob();
  if (blob.size !== source.sizeBytes || blob.type.split(';', 1)[0] !== source.mimeType) {
    throw new Error('VIDEO_EXPORT_INCOMPLETE');
  }
  const extension = source.mimeType === 'video/webm' ? 'webm' : source.mimeType === 'video/quicktime' ? 'mov' : 'mp4';
  const name = `${source.videoNote ? 'Видеокружок' : 'Видео'} Mezfit.${extension}`;
  return prepareVideoExport(new File([blob], name, { type: source.mimeType }), signal);
}
