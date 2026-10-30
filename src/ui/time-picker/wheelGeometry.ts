// The compact wheel draws its 72px SVG source inside a real 36px capsule.
export interface WheelGeometry {
  rowHeight: number;
  lensScaleY: number;
  glyphScaleY: number;
}
export const STANDARD_GEOMETRY: WheelGeometry = {
  rowHeight: 48, lensScaleY: 1, glyphScaleY: 1,
};
export const COMPACT_TIME_GEOMETRY: WheelGeometry = {
  rowHeight: 36, lensScaleY: 1 / 2, glyphScaleY: 2,
};
