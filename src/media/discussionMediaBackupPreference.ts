const STORAGE_KEY = 'mezfit.discussion-media-backup-v1';

/** Device-local preference shared by discussion uploads and reads. */
export function isDiscussionMediaBackupEnabled(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== 'off';
  } catch {
    return true;
  }
}

export function setDiscussionMediaBackupEnabled(enabled: boolean): boolean {
  try {
    if (enabled) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, 'off');
    return true;
  } catch {
    return false;
  }
}
