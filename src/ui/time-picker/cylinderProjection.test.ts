import { describe, expect, it } from 'vitest';
import { cylinderIndexAt, projectCylinder, visibleCylinderRows } from './cylinderProjection';

describe('cylindrical wheel projection', () => {
  it('keeps the selected center face-on and projects symmetric sides', () => {
    expect(projectCylinder(0)).toEqual({ y: 0, scaleX: 1, scaleY: 1, opacity: 1 });
    const upper = projectCylinder(-72)!;
    const lower = projectCylinder(72)!;
    expect(upper.y).toBe(-lower.y);
    expect(upper.scaleY).toBe(lower.scaleY);
    expect(lower.y).toBeLessThan(72);
    expect(lower.scaleY).toBeLessThan(lower.scaleX);
    expect(lower.opacity).toBeLessThan(1);
  });

  it('compresses spacing towards the horizon and hides the back of the cylinder', () => {
    const a = projectCylinder(36)!;
    const b = projectCylinder(72)!;
    const c = projectCylinder(108)!;
    expect(c.y - b.y).toBeLessThan(b.y - a.y);
    expect(projectCylinder(120 * Math.PI / 2)).toBeNull();
    expect(projectCylinder(-200)).toBeNull();
  });

  it('uses fractional scroll continuously and never creates duplicate range values', () => {
    const rows = visibleCylinderRows(24, 0.25 * 36, 36);
    expect(rows[0].y).toBeLessThan(0);
    expect(rows.every(row => row.index >= 0 && row.index < 24)).toBe(true);
    expect(new Set(rows.map(row => row.index)).size).toBe(rows.length);
  });

  it('maps taps to projected centers, including compressed outer rows', () => {
    for (const row of visibleCylinderRows(60, 20 * 36, 36)) {
      expect(cylinderIndexAt(60, 20 * 36, 36, row.y + 120)).toBe(row.index);
    }
  });
});
