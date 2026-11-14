/** Test-only device preference. Never synced between users or stored in the chat domain. */
export type VideoRecordingFormatPreference = 'mp4' | 'webm';
const STORAGE_KEY = 'mezfit.video-recording-format-v1';

export function getVideoRecordingFormatPreference(): VideoRecordingFormatPreference {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'webm' ? 'webm' : 'mp4';
  } catch {
    return 'mp4';
  }
}

export function setVideoRecordingFormatPreference(preference: VideoRecordingFormatPreference): boolean {
  try {
    if (preference === 'mp4') localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, preference);
    return true;
  } catch {
    return false;
  }
}
