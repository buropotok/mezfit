import { createContext, useContext } from 'react';
import type { Role } from '../api';

/** Routing capability supplied by the application navigation shell. */
export const AvatarProfileNavigationContext = createContext<((userId: string) => void) | null>(null);

export function useAvatarProfileNavigation(): ((userId: string) => void) | null {
  return useContext(AvatarProfileNavigationContext);
}

/** Role determines whether an avatar can expose a coach-managed contact profile. */
export function avatarProfileDestination(role: Role, actorUserId: string, avatarUserId: string): 'profile' | 'clients' {
  return role === 'client' || actorUserId === avatarUserId ? 'profile' : 'clients';
}
