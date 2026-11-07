import { liveQuery } from 'dexie';
import type { MezfitCloudDatabase } from './database';
import type { DiscussionScope } from './discussion-contracts';
import { DiscussionRepository, type DiscussionFeedRow } from './discussions';

/** Account-scoped projection subscription; React never owns Dexie queries. */
export function observeDiscussionFeed(db: MezfitCloudDatabase, actorUserId: string,
  scopes: readonly DiscussionScope[], includeDetails: boolean,
  next: (rows: DiscussionFeedRow[]) => void, error: (reason: unknown) => void): { unsubscribe(): void } {
  return liveQuery(async () => {
    const rows: DiscussionFeedRow[] = [];
    // Serialize membership validation and its transaction keepalive per realm.
    for (const scope of scopes) {
      const repository = new DiscussionRepository(db, actorUserId, scope);
      try {
        rows.push(...await repository.feed(includeDetails ? db : undefined, includeDetails));
      } catch (reason) {
        // Revocation may arrive before the contact projection is refreshed.
        if (!(reason instanceof Error) || reason.message !== 'DISCUSSION_ACCESS_DENIED') throw reason;
      }
    }
    return rows;
  }).subscribe({ next, error });
}
