import { useState } from 'react';
import { Button } from 'konsta/react';
import { Text } from '../ui/primitives';

export function DiscussionMedia({ src, type, preview = false }: {
  src: string;
  type: 'photo' | 'video';
  preview?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  return <div className={preview ? 'discussion-media discussion-media--preview' : 'discussion-media'}
    onClick={event => event.stopPropagation()}>
    {failed ? <div className="discussion-media__error">
      <Text variant="footnote" role="status">
        {type === 'photo' ? 'Фото' : 'Видео'} недоступно. Проверьте сеть и поддержку формата на устройстве.
      </Text>
      <Button rounded onClick={() => setFailed(false)}><Text variant="footnote">Повторить</Text></Button>
    </div> : type === 'photo'
      ? <img src={src} alt={preview ? 'Предпросмотр фото' : 'Фото во вложении'} loading={preview ? 'eager' : 'lazy'}
        referrerPolicy="no-referrer" onError={() => setFailed(true)} />
      : <video src={src} aria-label={preview ? 'Предпросмотр видео' : 'Видео во вложении'}
        playsInline controls preload={preview ? 'metadata' : 'none'} onError={() => setFailed(true)} />}
  </div>;
}
