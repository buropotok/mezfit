import type { MouseEvent, ReactNode } from 'react';
import { useAvatarProfileNavigation } from '../navigation/AvatarProfileNavigation';

/** App-owned navigation around a UI Kit avatar; the avatar primitive stays presentational. */
export function AvatarProfileLink({ userId, name, children }: {
  userId: string | null | undefined;
  name: string;
  children: ReactNode;
}) {
  const navigate = useAvatarProfileNavigation();
  if (!userId || !navigate) return <>{children}</>;

  const openProfile = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    navigate(userId);
  };
  return <button type="button" aria-label={`Открыть профиль: ${name}`}
    onClick={openProfile}
    onPointerDown={event => event.stopPropagation()}
    style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      padding: 0, border: 0, borderRadius: '50%', background: 'transparent',
      cursor: 'pointer', touchAction: 'manipulation' }}>
    {children}
  </button>;
}
