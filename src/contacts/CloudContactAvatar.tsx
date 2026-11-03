import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { UserAvatarRepository } from '../data/cloud/user-avatar';
import { UserAvatarSources } from '../data/cloud/user-avatar-sources';
import { Avatar, type AvatarSize } from '../ui';
import { useCloudConnections, type CloudContact } from '../data/cloud/CloudConnectionsProvider';

// Neutral image preserves the Avatar primitive's geometry while the higher-priority source is unknown.
export const AVATAR_LOADING_SRC = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/%3E';

/** Shared cloud avatar source for contacts rows and navigation identities. */
export function useCloudContactAvatarUrl(contact: CloudContact | null, variant: 'small' | 'large' = 'small'): string | undefined {
  const connections = useCloudConnections();
  const loadAvatar = connections?.loadAvatar;
  const cache = connections?.avatarUrls;
  const avatarLoadRevision = connections?.avatarLoadRevision ?? 0;
  const localSources = useMemo(() => !connections?.userAvatarSources && connections?.db && connections.actorUserId
    ? new UserAvatarSources(new UserAvatarRepository(connections.db, connections.actorUserId), connections.actorUserId)
    : null, [connections?.userAvatarSources, connections?.db, connections?.actorUserId]);
  const sources = connections?.userAvatarSources ?? localSources;
  useEffect(() => () => localSources?.dispose(), [localSources]);
  useEffect(() => { localSources?.refresh(); }, [localSources, avatarLoadRevision]);
  const userId = contact?.userId;
  const realmId = userId === connections?.actorUserId ? connections?.actorUserId : contact?.relationshipId;
  const subscribe = useCallback((listener: () => void) => sources && userId && realmId
    ? sources.subscribe(userId, realmId, listener, variant) : () => {}, [sources, userId, realmId, variant]);
  const getSnapshot = useCallback(() => sources && userId && realmId ? sources.get(userId, realmId) : null,
    [sources, userId, realmId]);
  const selected = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
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

  if (selected && selected.status !== 'ready') return connections?.userAvatarSources ? AVATAR_LOADING_SRC : undefined;
  if (selected?.custom) return selected[variant] ?? (connections?.userAvatarSources ? AVATAR_LOADING_SRC : undefined);
  return src;
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
