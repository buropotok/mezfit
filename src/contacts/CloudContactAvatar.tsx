import { useEffect, useMemo, useState } from 'react';
import { UserAvatarRepository, type UserAvatarSnapshot } from '../data/cloud/user-avatar';
import { Avatar, type AvatarSize } from '../ui';
import { useCloudConnections, type CloudContact } from '../data/cloud/CloudConnectionsProvider';

/** Shared cloud avatar source for contacts rows and navigation identities. */
export function useCloudContactAvatarUrl(contact: CloudContact | null, variant: 'small' | 'large' = 'small'): string | undefined {
  const connections = useCloudConnections();
  const loadAvatar = connections?.loadAvatar;
  const cache = connections?.avatarUrls;
  const avatarLoadRevision = connections?.avatarLoadRevision ?? 0;
  const repository = useMemo(() => connections?.db && connections.actorUserId
    ? new UserAvatarRepository(connections.db, connections.actorUserId) : null, [connections?.db, connections?.actorUserId]);
  const [custom, setCustom] = useState<{ repository: UserAvatarRepository; key: string; value: UserAvatarSnapshot } | null>(null);
  const customRealm = contact?.userId === connections?.actorUserId ? connections?.actorUserId : contact?.relationshipId;
  const customKey = contact?.userId + ':' + customRealm;
  useEffect(() => {
    if (!repository || !contact || !customRealm) return;
    let alive = true;
    const subscription = repository.observe(contact.userId, customRealm,
      value => { if (alive) setCustom({ repository, key: customKey, value }); },
      () => { if (alive) setCustom(null); });
    return () => { alive = false; subscription.unsubscribe(); };
  }, [repository, customKey, avatarLoadRevision]);
  const selected = custom?.repository === repository && custom?.key === customKey ? custom.value : null;
  const blob = selected && !selected.incomplete ? selected.value?.[variant] : null;
  const [customImage, setCustomImage] = useState<{ blob: Blob; url: string } | null>(null);
  useEffect(() => {
    if (!(blob instanceof Blob)) { setCustomImage(null); return; }
    const url = URL.createObjectURL(blob);
    setCustomImage({ blob, url });
    return () => URL.revokeObjectURL(url);
  }, [blob]);
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

  return selected?.incomplete || selected?.value?.small
    ? blob instanceof Blob && customImage?.blob === blob ? customImage.url : undefined
    : src;
}

/** Presentation adapter only: the UIkit Avatar retains all existing mechanics and styling. */
export function CloudContactAvatar({ contact, className, variant = 'small', size }: {
  contact: CloudContact;
  className?: string;
  variant?: 'small' | 'large';
  size?: AvatarSize;
}) {
  const src = useCloudContactAvatarUrl(contact, variant);
  return <Avatar name={contact.displayName} src={src} className={className} size={size} />;
}
