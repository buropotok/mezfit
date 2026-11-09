import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Text } from '../ui';
import { MezfitMessage } from '../ui/konsta-mezfit/Message';
import { VoiceMessagePlayer } from '../voice-note/VoiceMessagePlayer';
import { useVoiceRecorder, type VoiceRecording } from '../voice-note/useVoiceRecorder';

/**
 * Only a Settings gallery integration probe. The reusable recorder and player
 * don't depend on Settings; a future Messagebar/bubble owns the same API.
 */
export function VoiceMessageModule() {
  const { start, stop, status, error } = useVoiceRecorder();
  const [recording, setRecording] = useState<{ clip: VoiceRecording; url: string } | null>(null);
  const [playerError, setPlayerError] = useState('');
  const urlRef = useRef<string | null>(null);
  const mountedRef = useRef(false);

  const discardRecording = useCallback(() => {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = null;
    if (mountedRef.current) setRecording(null);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      discardRecording();
    };
  }, [discardRecording]);

  const begin = async () => {
    discardRecording();
    setPlayerError('');
    await start();
  };

  const finish = async () => {
    const clip = await stop();
    if (!mountedRef.current || !clip) return;
    try {
      const url = URL.createObjectURL(clip.blob);
      urlRef.current = url;
      setRecording({ clip, url });
    } catch {
      setPlayerError('Не удалось подготовить аудио для воспроизведения.');
    }
  };

  return (
    <section className="voice-note-module" aria-label="Тест записи голосового сообщения">
      {recording ? (
        <div className="voice-note-module__sample">
          <MezfitMessage
            type="sent"
            text=""
            bubbleSource={
              <VoiceMessagePlayer
                src={recording.url}
                waveform={recording.clip.waveform}
                durationMs={recording.clip.durationMs}
                onError={setPlayerError}
              />
            }
          />
        </div>
      ) : null}
      {status === 'recording' ? (
        <Button onClick={() => void finish()}>Завершить запись</Button>
      ) : status === 'requesting' || status === 'processing' ? (
        <Button disabled>{status === 'requesting' ? 'Подключаем микрофон…' : 'Сохраняем запись…'}</Button>
      ) : (
        <Button onClick={() => void begin()}>
          {recording ? 'Записать заново' : 'Записать голосовое'}
        </Button>
      )}
      {error ? <Text variant="footnote" role="alert">{error}</Text> : null}
      {playerError ? <Text variant="footnote" role="alert">{playerError}</Text> : null}
    </section>
  );
}
