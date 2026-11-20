const STORAGE_KEY = 'mezfit.discussion-media-backup-v1';

/** Device-local preference shared by discussion uploads and reads. */
export function isDiscussionMediaBackupEnabled(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'on';
  } catch {
    return false;
  }
}

export function setDiscussionMediaBackupEnabled(enabled: boolean): boolean {
  try {
    localStorage.setItem(STORAGE_KEY, enabled ? 'on' : 'off');
    return true;
  } catch {
    return false;
  }
}
