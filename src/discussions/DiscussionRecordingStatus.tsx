import { useEffect, useState } from 'react';
import { Link } from 'konsta/react';
import { Text } from '../ui/primitives';

/** Shared live composer for voice and video notes; no media playback or delivery. */
export function DiscussionRecordingStatus({ locked, onCancel }: { locked: boolean; onCancel: () => void }) {
  const [startedAt] = useState(() => Date.now());
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => setElapsed(Math.max(0, Date.now() - startedAt)), 100);
    return () => window.clearInterval(timer);
  }, [startedAt]);
  const seconds = Math.floor(elapsed / 1000);
  const time = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')},${Math.floor(elapsed % 1000 / 100)}`;
  return <div className="discussion-recording-status" role="group" aria-label="Идёт запись">
    <span className="discussion-recording-status__dot" aria-hidden="true" />
    <Text variant="body" className="discussion-recording-status__time">{time}</Text>
    <div className="discussion-recording-status__cancel">
      {locked
        ? <Link onClick={onCancel}><Text variant="body">ОТМЕНА</Text></Link>
        : <Text variant="body">‹ Влево — отмена</Text>}
    </div>
  </div>;
}
