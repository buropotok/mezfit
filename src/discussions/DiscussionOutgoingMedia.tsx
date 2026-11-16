import type { ReactNode, RefObject } from 'react';
import type { DiscussionMediaDraft } from '../data/cloud/discussion-media';
import { Icon } from '../ui/Icon';
import { Button, IconButton, Text } from '../ui/primitives';
import { MezfitMessage } from '../ui/konsta-mezfit/Message';
import { DiscussionMedia } from './DiscussionMedia';
import { DiscussionVideoNote } from './DiscussionVideoNote';
import { DiscussionVoice } from './DiscussionVoice';
import clock from './assets/upload-clock.svg';
import paperplane from './assets/upload-paperplane.svg';

export function DiscussionOutgoingMedia({ src, attachment, createdAt, status, error, retryDisabled = false, playbackHost, scrollViewport, onCancel, onRemove, onRetry, onOpen, onMenu, menu }: {
  src?: string;
  attachment: DiscussionMediaDraft;
  createdAt: string;
  status: 'uploading' | 'publishing' | 'failed' | 'clearing';
  error?: string;
  retryDisabled?: boolean;
  playbackHost?: HTMLElement | null;
  scrollViewport?: RefObject<HTMLDivElement | null>;
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
  const playable = status === 'failed' && Boolean(src);

  return <MezfitMessage type="sent" bubbleVariant={mediaType === 'voice' ? undefined : 'media'} bubbleSource={menu}
    opaqueTextFooter={mediaType !== 'voice'}
    textFooter={<>
      <div className={`discussion-outgoing__preview${mediaType === 'video-note' ? ' discussion-outgoing__preview--circle' : ''}`} data-playable={playable || undefined}>
        <div inert={!playable && mediaType !== 'voice'}>
          {!src ? <Text variant="caption">Файл на устройстве недоступен</Text>
            : mediaType === 'voice'
              ? <DiscussionVoice src={src} durationMs={(durationSeconds ?? 0) * 1000} waveform={waveform ?? []}
                  leadingControl={sending ? <IconButton icon="x" color="gray" selected label="Отменить загрузку"
                    disabled={status === 'publishing'} onClick={onCancel} /> : undefined} />
              : mediaType === 'video-note'
                ? <DiscussionVideoNote src={src} durationSeconds={durationSeconds ?? 0}
                    playbackHost={playable ? playbackHost : undefined} scrollViewport={playable ? scrollViewport : undefined} />
                : <DiscussionMedia src={src} type={mediaType} durationSeconds={durationSeconds} mode="thumbnail" onOpen={onOpen} />}
        </div>
        <div className="discussion-media__meta">{meta}</div>
        {sending && <img className="discussion-outgoing__loader" src={paperplane} alt="" />}
        {sending && mediaType !== 'voice' && <div className="discussion-outgoing__cancel">
          <IconButton icon="x" theme="liquidGlass" label="Отменить загрузку"
            disabled={status === 'publishing'} onClick={onCancel} />
        </div>}
        {onMenu && <div className="discussion-media__menu">
          <IconButton icon="dots-vertical" label="Действия неотправленного видео" onClick={onMenu} />
        </div>}
      </div>
      {!sending && <div className="discussion-outgoing__retry">
        {error && <Text variant="caption" role="alert">{error}</Text>}
        <div className="discussion-outgoing__retry-actions">
          <Button size="compact" color="yellow" disabled={status === 'clearing' || !src || retryDisabled} onClick={onRetry}>
            <Text variant="caption" className="discussion-outgoing__retry-label">Ещё раз</Text>
          </Button>
          <Button size="compact" color="red" disabled={status === 'clearing'} onClick={onRemove}>
            <Text variant="caption" className="discussion-outgoing__retry-label">Отменить</Text>
          </Button>
        </div>
      </div>}
    </>} />;
}
