import { useEffect, useState } from 'react';
import { IconButton } from '../ui/primitives';
import { DiscussionMedia } from './DiscussionMedia';

export function DiscussionPhotoPreview({ file, onRemove }: { file: File; onRemove: () => void }) {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    const preview = URL.createObjectURL(file);
    setUrl(preview);
    return () => URL.revokeObjectURL(preview);
  }, [file]);

  return <div className="discussion-photo-preview">
    {url && <DiscussionMedia src={url} type="photo" mode="preview" />}
    <IconButton icon="x" label={`Убрать фото ${file.name}`} onClick={onRemove} />
  </div>;
}
