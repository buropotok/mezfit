import { useEffect, useState } from 'react';
import { Avatar } from '../ui';
import { useCloudConnections, type CloudContact } from '../data/cloud/CloudConnectionsProvider';

/** Shared cloud avatar source for contacts rows and navigation identities. */
export function useCloudContactAvatarUrl(contact: CloudContact | null, variant: 'small' | 'large' = 'small'): string | undefined {
  const connections = useCloudConnections();
  const loadAvatar = connections?.loadAvatar;
  const cache = connections?.avatarUrls;
  const avatarLoadRevision = connections?.avatarLoadRevision ?? 0;
  const identity = contact ? [contact.relationshipId, contact.userId, contact.avatarVersion ?? '', contact.avatarMode ?? 'legacy', variant].join(':') : '';
  const [image, setImage] = useState<{ identity: string; src?: string }>();
  const src = contact && cache ? cache.get(contact, variant) : image?.identity === identity ? image.src : undefined;

  useEffect(() => {
    let active = true;
    let objectUrl: string | undefined;

    if (contact?.avatarVersion && loadAvatar) {
      const loading = cache ? cache.load(contact, () => loadAvatar(contact, variant), variant) : loadAvatar(contact, variant).then(blob => {
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
  }, [identity, cache, loadAvatar, variant, avatarLoadRevision]);

  return src;
}

/** Presentation adapter only: the UIkit Avatar retains all existing mechanics and styling. */
export function CloudContactAvatar({ contact, className, variant = 'small' }: {
  contact: CloudContact;
  className?: string;
  variant?: 'small' | 'large';
}) {
  const src = useCloudContactAvatarUrl(contact, variant);
  return <Avatar name={contact.displayName} src={src} className={className} />;
}
