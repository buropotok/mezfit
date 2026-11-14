import { useState } from 'react';
import { Range } from 'konsta/react';
import { Text } from '../ui';
import {
  getVideoRecordingFormatPreference,
  setVideoRecordingFormatPreference,
  type VideoRecordingFormatPreference,
} from '../video-note/video-recording-format-preference';

/** Device-local format selection, shared by the module preview and the chat recorder. */
export function VideoRecordingFormatControl() {
  const [recordingFormat, setRecordingFormat] = useState<VideoRecordingFormatPreference>(
    getVideoRecordingFormatPreference,
  );
  const [recordingPreferenceError, setRecordingPreferenceError] = useState(false);

  return (
    <div className="settings-page__glass-field">
      <label htmlFor="video-recording-format-preference">
        <Text variant="body">Формат записи: {recordingFormat === 'webm' ? 'WebM (принудительно)' : 'MP4 → WebM (автоматически)'}</Text>
      </label>
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <Text variant="caption" tone="muted">MP4</Text>
        <Text variant="caption" tone="muted">WebM</Text>
      </div>
      <Range
        inputId="video-recording-format-preference"
        min={0}
        max={1}
        step={1}
        value={recordingFormat === 'webm' ? 1 : 0}
        onChange={event => {
          const next: VideoRecordingFormatPreference = Number(event.target.value) === 1 ? 'webm' : 'mp4';
          if (setVideoRecordingFormatPreference(next)) {
            setRecordingFormat(next);
            setRecordingPreferenceError(false);
          } else {
            setRecordingPreferenceError(true);
          }
        }}
      />
      <Text variant="footnote" tone="muted">
        MP4 — с автоматическим запасным WebM. WebM — только WebM для проверки на этом устройстве. Применяется и в чате.
      </Text>
      {recordingPreferenceError && (
        <Text variant="footnote" role="alert">Не удалось сохранить выбранный формат на устройстве.</Text>
      )}
    </div>
  );
}
