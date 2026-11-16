import { createContext, useContext } from 'react';

export type AvatarFlightRect = { left: number; top: number; width: number; height: number };

export type AvatarFlightOrigin = {
  key: string;
  source: AvatarFlightRect;
  avatar: { name: string; src?: string };
};

export type DiscussionAvatarFlightController = {
  begin: (origin: AvatarFlightOrigin) => void;
  cancel: () => void;
};

export const DiscussionAvatarFlightContext = createContext<DiscussionAvatarFlightController | null>(null);

const noopController: DiscussionAvatarFlightController = { begin: () => {}, cancel: () => {} };

/** Features request presentation; NavigationShell owns the actual transition. */
export function useDiscussionAvatarFlight(): DiscussionAvatarFlightController {
  return useContext(DiscussionAvatarFlightContext) ?? noopController;
}

export function discussionAvatarFlightKey(realmId: string, anchorKey: string): string {
  return JSON.stringify([realmId, anchorKey]);
}
