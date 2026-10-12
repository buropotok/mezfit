import { useEffect, useState } from 'react';
import { Avatar } from '../ui';
import { useCloudConnections, type CloudContact } from '../data/cloud/CloudConnectionsProvider';

/** Presentation adapter only: the UIkit Avatar retains all existing mechanics and styling. */
export function CloudContactAvatar({ contact }: { contact: CloudContact }) {
  const connections = useCloudConnections();
  const loadAvatar = connections?.loadAvatar;
  const [src, setSrc] = useState<string | undefined>();

  useEffect(() => {
    let active = true;
    let objectUrl: string | undefined;
    setSrc(undefined);

    if (contact.avatarVersion && loadAvatar) {
      void loadAvatar(contact).then((blob) => {
        if (!active || !blob) return;
        objectUrl = URL.createObjectURL(blob);
        setSrc(objectUrl);
      }).catch(() => {});
    }
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [contact.userId, contact.relationshipId, contact.avatarVersion, loadAvatar]);

  return <Avatar name={contact.displayName} src={src} />;
}
