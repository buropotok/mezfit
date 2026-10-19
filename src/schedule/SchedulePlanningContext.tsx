import { createContext, useContext } from 'react';

/** Shell-level navigation intent; storage remains owned by the domain repository. */
export interface SchedulePlanningNavigation {
  requestedDraftId: string | null;
  viewResetKey?: number;
  requestedClientUserId?: string | null;
  openDraft: (id: string, clientUserId?: string | null) => void;
  clearDraft: () => void;
}

export const SchedulePlanningContext = createContext<SchedulePlanningNavigation | null>(null);

export function useSchedulePlanning(): SchedulePlanningNavigation | null {
  return useContext(SchedulePlanningContext);
}
