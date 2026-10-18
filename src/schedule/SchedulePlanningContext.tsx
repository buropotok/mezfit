import { createContext, useContext } from 'react';

/** Shell-level navigation intent; storage remains owned by the domain repository. */
export interface SchedulePlanningNavigation {
  requestedDraftId: string | null;
  openDraft: (id: string) => void;
  clearDraft: () => void;
}

export const SchedulePlanningContext = createContext<SchedulePlanningNavigation | null>(null);

export function useSchedulePlanning(): SchedulePlanningNavigation | null {
  return useContext(SchedulePlanningContext);
}
