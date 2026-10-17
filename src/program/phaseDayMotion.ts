/** Shared travel: every moving card starts together and stops at its own slot.
 * A short acceleration and a distance-based braking zone avoid abrupt stops. */
export const PHASE_MOTION_MS = 400;
export function phaseDayPosition(distance: number, maximum: number, progress: number): number {
  if (distance <= 0 || maximum <= 0 || progress <= 0) return 0;
  if (progress >= 1) return distance;
  const acceleration = 0.08;
  const travel = maximum * 1.08 * (progress < acceleration
    ? progress * progress / (2 * acceleration)
    : progress - acceleration / 2) / (1 - acceleration / 2);
  const brake = Math.min(distance * 0.15, maximum * 0.08);
  if (travel <= distance - brake) return travel;
  const fraction = Math.min(1, (travel - distance + brake) / (2 * brake));
  return distance - brake + brake * (2 * fraction - fraction * fraction);
}
