import type { DiscussionMediaDraft } from '../data/cloud/discussion-media';
import { Icon } from '../ui/Icon';
import { Button, IconButton, Text } from '../ui/primitives';
import { MezfitMessage } from '../ui/konsta-mezfit/Message';
import { DiscussionMedia } from './DiscussionMedia';
import { DiscussionVideoNote } from './DiscussionVideoNote';
import { DiscussionVoice } from './DiscussionVoice';
import clock from './assets/upload-clock.svg';
import paperplane from './assets/upload-paperplane.svg';

export function DiscussionOutgoingMedia({ src, attachment, createdAt, status, error, onCancel, onRemove, onRetry }: {
  src: string;
  attachment: DiscussionMediaDraft;
  createdAt: string;
  status: 'uploading' | 'publishing' | 'failed' | 'clearing';
  error?: string;
  onCancel: () => void;
  onRemove: () => void;
  onRetry: () => void;
}) {
  const sending = status === 'uploading' || status === 'publishing';
  const time = new Date(createdAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  const meta = <Text variant="caption" className="discussion-message-meta">
    {time}
    {sending
      ? <img className="discussion-outgoing__status" src={clock} alt="Отправляется" />
      : <span className="discussion-outgoing__status discussion-outgoing__status--failed"
          role="img" aria-label="Отправка не удалась"><Icon name="x" /></span>}
  </Text>;
  const { mediaType, durationSeconds, waveform } = attachment;

  return <MezfitMessage type="sent" bubbleVariant={mediaType === 'voice' ? undefined : 'media'}
    textFooter={<>
      <div className="discussion-outgoing__preview">
        <div inert>
          {mediaType === 'voice'
            ? <DiscussionVoice src={src} durationMs={(durationSeconds ?? 0) * 1000} waveform={waveform ?? []} />
            : mediaType === 'video-note'
              ? <DiscussionVideoNote src={src} durationSeconds={durationSeconds ?? 0} />
              : <DiscussionMedia src={src} type={mediaType} durationSeconds={durationSeconds} mode="thumbnail" />}
        </div>
        <div className="discussion-media__meta">{meta}</div>
        <div className="discussion-outgoing__cancel">
          {sending && <span className="discussion-outgoing__loader" aria-hidden="true">
            <img src={paperplane} alt="" />
          </span>}
          <IconButton icon="x" theme="glass" label={sending ? 'Отменить загрузку' : 'Убрать вложение'}
            disabled={status === 'publishing' || status === 'clearing'}
            onClick={sending ? onCancel : onRemove} />
        </div>
      </div>
      {!sending && <div className="discussion-outgoing__retry">
        {error && <Text variant="caption" role="alert">{error}</Text>}
        <Button size="compact" color="yellow" disabled={status === 'clearing'} onClick={onRetry}>
          <Text variant="caption" className="discussion-outgoing__retry-label">Ещё раз</Text>
        </Button>
      </div>}
    </>} />;
}
