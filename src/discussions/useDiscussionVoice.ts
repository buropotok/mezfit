import { useRef, useState } from 'react';
import { hasSessionMicrophone } from '../voice-note/sessionMicrophone';
import { useVoiceRecorder, type VoiceRecording } from '../voice-note/useVoiceRecorder';
import { useRecordingGesture } from './useRecordingGesture';

export function useDiscussionVoice(onRecorded: (clip: VoiceRecording, send?: boolean) => void, onCancelGesture?: () => void) {
  const [permissionReady, setPermissionReady] = useState(false);
  const [levels, setLevels] = useState<number[]>([]);
  const { start, stop, release, status, error } = useVoiceRecorder({
    session: true,
    onSample: level => setLevels(previous => [...previous.slice(-41), Math.min(1, level * 5)]),
  });
  const generation = useRef(0);
  const latest = useRef(onRecorded);
  latest.current = onRecorded;
  const gesture = useRecordingGesture({ status, onCancelGesture,
    start: async () => {
      setLevels([]);
      const permissionOnly = !hasSessionMicrophone();
      setPermissionReady(false);
      const started = await start(permissionOnly);
      if (permissionOnly && hasSessionMicrophone()) setPermissionReady(true);
      return started;
    },
    finish: mode => {
      const recordingGeneration = generation.current;
      void stop().then(clip => {
        if (clip && generation.current === recordingGeneration) {
          if (mode === 'send') latest.current(clip, true);
          else latest.current(clip);
        }
      });
    },
    cancel: () => { generation.current += 1; release(); },
  });
  return { ...gesture, status, permissionReady, error: status === 'error' ? error : '', levels };
}
