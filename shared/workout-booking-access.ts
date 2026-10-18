/** Structural target, independent from program/day replication and business state. */
export interface WorkoutBookingAccess {
  realmId: string;
  athleteUserId: string;
  coachUserId: string | null;
  clientUserId: string | null;
}
const user = (value: unknown): value is string =>
  typeof value === 'string' && /^tg:[1-9][0-9]*$/.test(value);
export function isWorkoutBookingAccess(value: unknown): value is WorkoutBookingAccess {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  if (typeof row.realmId !== 'string' || !row.realmId || !user(row.athleteUserId)) return false;
  if (row.coachUserId === null && row.clientUserId === null)
    return row.realmId === row.athleteUserId;
  return user(row.coachUserId) && user(row.clientUserId)
    && row.coachUserId !== row.clientUserId && row.athleteUserId === row.clientUserId;
}
