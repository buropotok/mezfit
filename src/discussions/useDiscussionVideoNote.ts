import { useRef, useState } from 'react';
import { useVideoNoteRecorder, type VideoNoteRecording } from '../video-note/useVideoNoteRecorder';
import { useRecordingGesture } from './useRecordingGesture';

/** Chat owns gestures and delivery intent; the existing engine owns the recording. */
export function useDiscussionVideoNote(onRecorded: (clip: VideoNoteRecording, preview?: boolean) => void, onCancelGesture?: () => void) {
  const [permissionReady, setPermissionReady] = useState(false);
  const delivery = useRef<'send' | 'preview'>('preview');
  const recorder = useVideoNoteRecorder(clip => {
    const intent = delivery.current;
    // Recorder deadlines and later engine events cannot authorize publication.
    delivery.current = 'preview';
    if (intent === 'send') onRecorded(clip);
    else onRecorded(clip, true);
  });
  const gesture = useRecordingGesture({ status: recorder.status, onCancelGesture,
    onLock: () => { delivery.current = 'preview'; },
    start: async () => {
      delivery.current = 'preview';
      const permissionOnly = !recorder.hasStream('user');
      setPermissionReady(false);
      const started = await recorder.start('user', permissionOnly);
      if (recorder.hasStream('user') && permissionOnly) setPermissionReady(true);
      return started;
    },
    finish: mode => { delivery.current = mode === 'preview' ? 'preview' : 'send'; void recorder.stop(); },
    cancel: recorder.cancel,
  });
  const release = () => { gesture.cancel(); recorder.release(); setPermissionReady(false); };
  return { ...gesture, release, status: recorder.status, error: recorder.error,
    stream: recorder.stream, progress: recorder.progress, permissionReady };
}
