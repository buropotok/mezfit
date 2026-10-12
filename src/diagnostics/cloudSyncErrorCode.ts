/**
 * Classify Dexie Cloud errors without ever rendering raw error messages,
 * responses, origins, signed Telegram payloads, or bearer credentials.
 */
export function cloudSyncErrorCode(value: unknown): string | null {
  if (value == null) return null;

  let message = '';
  let httpStatus: number | undefined;

  if (typeof value === 'string') {
    message = value;
  } else if (typeof value === 'object') {
    const error = value as { message?: unknown; httpStatus?: unknown };
    if (typeof error.message === 'string') message = error.message;
    if (typeof error.httpStatus === 'number') httpStatus = error.httpStatus;
  }

  const statusText = message.trim()
    .replace(/^Error:\s*/i, '')
    .replace(/^Sync error:\s*/i, '')
    .replace(/^HttpError:\s*/i, '');
  const match = statusText.match(/^([45][0-9]{2})(?=\s|$)/);
  const status = httpStatus ?? (match ? Number(match[1]) : undefined);
  if (status !== undefined && Number.isInteger(status) && status >= 400 && status <= 599) {
    return `HTTP_${status}`;
  }
  if (/networkerror|network error|failed to fetch|fetch failed|load failed|network request failed/i.test(message)) {
    return 'NETWORK_ERROR';
  }
  if (/license (?:has )?expired|license deactivated/i.test(message)) {
    return 'CLOUD_LICENSE';
  }
  return 'OTHER_SYNC_ERROR';
}
