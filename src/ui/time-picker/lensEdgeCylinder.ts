export interface LensEdgeCylinderSlice {
  edge: 'top' | 'bottom';
  clipY: number;
  clipHeight: number;
  scaleY: number;
  translateY: number;
  opacity: number;
}

/**
 * Inverse projection of two quarter-cylinders at the lens edges.
 * Each clipped slice samples a different strip of the same SVG source,
 * approximating a continuous pixel bend without SVG displacement filters.
 * The middle of the lens is deliberately left untransformed.
 */
export function buildLensEdgeCylinderSlices(
  lensHeight: number,
  radius: number,
  segments: number,
): LensEdgeCylinderSlice[] {
  if (!Number.isFinite(lensHeight) || !Number.isFinite(radius)
    || lensHeight <= 0 || radius <= 0 || radius * 2 >= lensHeight
    || !Number.isInteger(segments) || segments < 1) {
    throw new RangeError('Invalid lens edge cylinder geometry');
  }

  // A quarter-circle uses arc length R * PI / 2, projected into R pixels.
  const topSourceY = (y: number) => radius
    - radius * Math.asin(Math.max(0, Math.min(1, (radius - y) / radius)));
  const sourceY = (edge: 'top' | 'bottom', y: number) => edge === 'top'
    ? topSourceY(y)
    : lensHeight - topSourceY(lensHeight - y);

  return Array.from({ length: segments * 2 }, (_, index) => {
    const edge = index < segments ? 'top' : 'bottom';
    const segment = index % segments;
    const origin = edge === 'top' ? 0 : lensHeight - radius;
    const clipY = origin + radius * segment / segments;
    const clipEnd = origin + radius * (segment + 1) / segments;
    const sourceStart = sourceY(edge, clipY);
    const sourceEnd = sourceY(edge, clipEnd);
    const scaleY = (clipEnd - clipY) / (sourceEnd - sourceStart);
    const midpoint = (clipY + clipEnd) / 2;
    const radial = edge === 'top'
      ? (radius - midpoint) / radius
      : (midpoint - (lensHeight - radius)) / radius;

    return {
      edge,
      clipY,
      clipHeight: clipEnd - clipY,
      scaleY,
      translateY: clipY - scaleY * sourceStart,
      opacity: Math.sqrt(1 - radial * radial),
    };
  });
}
