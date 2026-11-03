import { createContext, useContext } from 'react';

/** Routing capability supplied by the application navigation shell. */
export const AvatarProfileNavigationContext = createContext<((userId: string) => void) | null>(null);

export function useAvatarProfileNavigation(): ((userId: string) => void) | null {
  return useContext(AvatarProfileNavigationContext);
}
