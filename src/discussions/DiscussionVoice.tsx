import { useState, type ReactNode } from 'react';
import { Button } from 'konsta/react';
import { IconButton, Text } from '../ui/primitives';
import { VoiceMessagePlayer } from '../voice-note/VoiceMessagePlayer';
import type { DiscussionMediaCacheEntry } from '../media/discussionMediaCache';
import { useDiscussionMediaSource } from './useDiscussionMediaSource';

export function DiscussionVoice({ src, waveform, durationMs, cache, onMenu, meta }: {
  src: string;
  waveform: number[];
  durationMs: number;
  cache?: DiscussionMediaCacheEntry;
  onMenu?: () => void;
  meta?: ReactNode;
}) {
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const { url, container } = useDiscussionMediaSource(src, cache, 'cache-only', retry, false);
  return <div className="discussion-voice" ref={container}>
    {url && <VoiceMessagePlayer key={retry} src={url} waveform={waveform} durationMs={durationMs} onError={setError} />}
    {onMenu && <IconButton icon="dots-vertical" label="Действия сообщения" onClick={event => {
      event.stopPropagation(); onMenu();
    }} />}
    {error && <div className="discussion-voice__error">
      <Text variant="footnote" role="alert">{error}</Text>
      <Button rounded onClick={event => {
        event.stopPropagation(); setError(''); setRetry(value => value + 1);
      }}><Text variant="footnote">Повторить</Text></Button>
    </div>}
    {meta && <div className="discussion-voice__meta">{meta}</div>}
  </div>;
}

export function DiscussionVoiceRecording({ levels }: { levels: number[] }) {
  return <div className="discussion-voice-recording" role="status" aria-label="Идёт запись голосового сообщения">
    <span className="discussion-voice-recording__dot" />
    <svg viewBox="0 0 210 32" preserveAspectRatio="none" aria-hidden="true">
      {levels.map((level, index) => {
        const height = 3 + level * 25;
        return <rect key={index} x={index * 5 + 1} y={(32 - height) / 2} width="3" height={height} rx="1.5" />;
      })}
    </svg>
  </div>;
}
