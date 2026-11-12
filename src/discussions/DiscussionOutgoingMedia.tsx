import type { ReactNode } from 'react';
import type { DiscussionMediaDraft } from '../data/cloud/discussion-media';
import { Icon } from '../ui/Icon';
import { Button, IconButton, Text } from '../ui/primitives';
import { MezfitMessage } from '../ui/konsta-mezfit/Message';
import { DiscussionMedia } from './DiscussionMedia';
import { DiscussionVideoNote } from './DiscussionVideoNote';
import { DiscussionVoice } from './DiscussionVoice';
import clock from './assets/upload-clock.svg';
import paperplane from './assets/upload-paperplane.svg';

export function DiscussionOutgoingMedia({ src, attachment, createdAt, status, error, onCancel, onRemove, onRetry, onOpen, onMenu, menu }: {
  src: string;
  attachment: DiscussionMediaDraft;
  createdAt: string;
  status: 'uploading' | 'publishing' | 'failed' | 'clearing';
  error?: string;
  onCancel: () => void;
  onRemove: () => void;
  onRetry: () => void;
  onOpen?: () => void;
  onMenu?: () => void;
  menu?: ReactNode;
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
  const playable = status === 'failed' && (Boolean(onOpen) || mediaType === 'video-note');

  return <MezfitMessage type="sent" bubbleVariant={mediaType === 'voice' ? undefined : 'media'} bubbleSource={menu}
    opaqueTextFooter={mediaType !== 'voice'}
    textFooter={<>
      <div className="discussion-outgoing__preview" data-playable={playable || undefined}>
        <div inert={!playable}>
          {mediaType === 'voice'
            ? <DiscussionVoice src={src} durationMs={(durationSeconds ?? 0) * 1000} waveform={waveform ?? []} />
            : mediaType === 'video-note'
              ? <DiscussionVideoNote src={src} durationSeconds={durationSeconds ?? 0} />
              : <DiscussionMedia src={src} type={mediaType} durationSeconds={durationSeconds} mode="thumbnail" onOpen={onOpen} />}
        </div>
        <div className="discussion-media__meta">{meta}</div>
        {sending && <img className="discussion-outgoing__loader" src={paperplane} alt="" />}
        <div className="discussion-outgoing__cancel">
          <IconButton icon="x" theme={sending ? 'liquidGlass' : 'glass'} label={sending ? 'Отменить загрузку' : 'Убрать вложение'}
            disabled={status === 'publishing' || status === 'clearing'}
            onClick={sending ? onCancel : onRemove} />
        </div>
        {onMenu && <div className="discussion-media__menu">
          <IconButton icon="dots-vertical" label="Действия неотправленного видео" onClick={onMenu} />
        </div>}
      </div>
      {!sending && <div className="discussion-outgoing__retry">
        {error && <Text variant="caption" role="alert">{error}</Text>}
        <Button size="compact" color="yellow" disabled={status === 'clearing'} onClick={onRetry}>
          <Text variant="caption" className="discussion-outgoing__retry-label">Ещё раз</Text>
        </Button>
      </div>}
    </>} />;
}
