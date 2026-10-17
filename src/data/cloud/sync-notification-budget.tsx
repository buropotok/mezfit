import { createContext, useContext } from 'react';

/** Presentation budget owned by the application's cloud provider, not by a page. */
export function createSyncNotificationBudget() {
  let shown = 0;
  return {
    claim() {
      if (shown >= 3) return false;
      shown++;
      return true;
    },
    reset() { shown = 0; },
  };
}

export const SyncNotificationBudgetContext = createContext<ReturnType<typeof createSyncNotificationBudget> | null>(null);
export function useSyncNotificationBudget() { return useContext(SyncNotificationBudgetContext); }
