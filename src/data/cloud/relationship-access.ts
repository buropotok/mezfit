import Dexie from 'dexie';
import { checkApprovedAssignedPair, validatedTelegramId, type AssignedPairCheck } from '../../../shared/approved-relationship';

export const telegramId = validatedTelegramId;

/** Local Dexie transactions require a keepalive while verifying relationship hashes. */
export function isApprovedAssignedPair(
  realm: AssignedPairCheck['realm'],
  members: readonly AssignedPairCheck['members'][number][],
  coachUserId: string,
  clientUserId: string,
): Promise<boolean> {
  const coach = telegramId(coachUserId), client = telegramId(clientUserId);
  if (!coach || !client || coach === client || !realm) return Dexie.Promise.resolve(false);
  return Dexie.waitFor(checkApprovedAssignedPair({ realm, members, coachUserId, clientUserId }));
}

/** Validate multiple relationships with one waitFor, not overlapping keepalive loops. */
export function approvedAssignedPairs(checks: readonly AssignedPairCheck[]): Promise<boolean[]> {
  if (!checks.length) return Dexie.Promise.resolve([]);
  return Dexie.waitFor(Promise.all(checks.map(checkApprovedAssignedPair)));
}
