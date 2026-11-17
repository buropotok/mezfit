import { useEffect, useMemo, useState } from 'react';
import type { MezfitCloudDatabase } from '../data/cloud/database';
import {
  DiscussionOrganizationRepository,
  type DiscussionOrganizationSnapshot,
} from '../data/cloud/discussion-organization';
import type { DiscussionInboxRow } from './DiscussionsProvider';

export function useDiscussionOrganization(
  db: MezfitCloudDatabase | undefined, actorId: string | undefined, role: 'coach' | 'client',
  rows: readonly DiscussionInboxRow[],
) {
  const repository = useMemo(() => db && actorId ? new DiscussionOrganizationRepository(db, actorId) : null,
    [db, actorId]);
  const scope = useMemo(() => ({}), [repository, role]);
  // Feed previews, unread, lastActivityAt and sort order can change without
  // changing the saved thread identity used by the organization repository.
  const threadKey = JSON.stringify(rows.map(({ thread }) => JSON.stringify([
    thread.id, thread.realmId, thread.coachClientId, thread.owner, thread.anchorKey, thread.anchor, thread.contextPath,
    thread.createdAt, thread.derivedTitleSnapshot,
  ])).sort());
  const threads = useMemo(() => rows.map(row => row.thread), [threadKey]);
  const [revision, setRevision] = useState(0);
  const observation = useMemo(() => ({}), [scope, threads, revision]);
  const [result, setResult] = useState<{
    scope: object;
    observation: object;
    value: DiscussionOrganizationSnapshot | null;
    failed: boolean;
  } | null>(null);

  useEffect(() => {
    if (!repository) return;
    let active = true;
    const fail = () => {
      if (active) setResult(current => ({ scope, observation,
        value: current?.scope === scope ? current.value : null, failed: true }));
    };
    try {
      const subscription = repository.observe(threads, value => {
        if (active) setResult({ scope, observation, value, failed: false });
      }, fail);
      return () => { active = false; subscription.unsubscribe(); };
    } catch {
      fail();
      active = false;
    }
  }, [repository, scope, observation, threads]);

  const current = result?.observation === observation ? result : null;
  return {
    repository,
    scope,
    categories: result?.scope === scope ? result.value?.categories ?? [] : [],
    snapshot: current?.failed ? null : current?.value ?? null,
    loading: Boolean(repository && !current),
    failed: current?.failed ?? false,
    retry: () => setRevision(value => value + 1),
  };
}
