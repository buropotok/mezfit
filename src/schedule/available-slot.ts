import type { CloudWorkoutOccurrenceRow } from '../data/cloud/workout-foundation-types';

/** A local suggestion only; exhaustion must never return an unchecked slot. */
export function nextAvailableSlot(
  entries: readonly Pick<CloudWorkoutOccurrenceRow, 'startsAtUtc' | 'durationMinutes'>[],
  from: Date, durationMinutes: number,
): Date | null {
  const slot = new Date(from);
  slot.setSeconds(0, 0);
  slot.setMinutes(Math.ceil(slot.getMinutes() / 15) * 15);
  if (slot.getHours() < 8) slot.setHours(8, 0, 0, 0);
  for (let i = 0; i < 14 * 96; i++) {
    if (slot.getHours() >= 22 || slot.getHours() * 60 + slot.getMinutes() + durationMinutes > 22 * 60) {
      slot.setDate(slot.getDate() + 1);
      slot.setHours(8, 0, 0, 0);
    }
    const start = slot.getTime(), end = start + durationMinutes * 60_000;
    if (entries.every(row => end <= Date.parse(row.startsAtUtc)
      || start >= Date.parse(row.startsAtUtc) + row.durationMinutes * 60_000)) return slot;
    slot.setMinutes(slot.getMinutes() + 15);
  }
  return null;
}
