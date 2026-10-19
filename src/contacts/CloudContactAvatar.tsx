import { useEffect, useState } from 'react';
import { Avatar } from '../ui';
import { useCloudConnections, type CloudContact } from '../data/cloud/CloudConnectionsProvider';

/** Presentation adapter only: the UIkit Avatar retains all existing mechanics and styling. */
export function CloudContactAvatar({ contact, className }: { contact: CloudContact; className?: string }) {
  const connections = useCloudConnections();
  const loadAvatar = connections?.loadAvatar;
  const cache = connections?.avatarUrls;
  const identity = [contact.relationshipId, contact.userId, contact.avatarVersion ?? ''].join(':');
  const [image, setImage] = useState<{ identity: string; src?: string }>();
  const src = cache ? cache.get(contact) : image?.identity === identity ? image.src : undefined;

  useEffect(() => {
    let active = true;
    let objectUrl: string | undefined;

    if (contact.avatarVersion && loadAvatar) {
      const loading = cache ? cache.load(contact, () => loadAvatar(contact)) : loadAvatar(contact).then(blob => {
        if (!blob || !active) return undefined;
        objectUrl = URL.createObjectURL(blob);
        return objectUrl;
      });
      void loading.then((url) => {
        if (!active || !url) return;
        setImage({ identity, src: url });
      }).catch(() => {});
    }
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [identity, cache, loadAvatar]);

  return <Avatar name={contact.displayName} src={src} className={className} />;
}
