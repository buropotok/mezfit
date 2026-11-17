import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('./discussion-sheet.css', import.meta.url), 'utf8');
const source = readFileSync(new URL('./DiscussionSwipeReplyRow.tsx', import.meta.url), 'utf8');

describe('reply swipe geometry and ring clearance contract', () => {
  it('centers the icon in the right-side gap and uses the same 180ms return as the bubble', () => {
    const gap = css.match(/\.discussion-reply-swipe-indicator\s*\{([^}]+)\}/)?.[1] ?? '';
    const row = css.match(/\.discussion-message-target--reply-swipe\s*\{([^}]+)\}/)?.[1] ?? '';
    expect(gap).toContain('left: 100%');
    expect(gap).toContain('transition: width 180ms ease-out, opacity 180ms ease-out');
    expect(row).toContain('transition: transform 180ms ease-out');
    expect(gap).toContain('overflow: hidden');
    expect(source).toContain('style={{ width: `${distance}px`, opacity }}');
    expect(source).toContain('DISCUSSION_REPLY_SWIPE_TRIGGER_PX = 60');
    expect(source).toContain('DISCUSSION_REPLY_SWIPE_MAX_PX = 100');
  });

  it('limits the circle and pulsed ring to a 4px edge margin across the entire 0..100px swipe', () => {
    const circle = css.match(/\.discussion-reply-swipe-indicator__circle\s*\{([^}]+)\}/)?.[1] ?? '';
    const ring = css.match(/\.discussion-reply-swipe-indicator__progress\s*\{([^}]+)\}/)?.[1] ?? '';
    const pulse = css.match(/@keyframes discussion-reply-ring-pulse\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';
    for (const block of [circle, ring]) {
      expect(block).toContain('width: max(0px, min(34px, calc(100% - 8px)))');
      expect(block).toContain('left: 50%');
      expect(block).toContain('top: 50%');
    }
    expect(pulse).toContain('min(51.68px, calc(100% - 8px))');
    expect(css).toContain('animation: discussion-reply-ring-pulse 50ms ease-out 1');
    // The 34px base circle equals a standard one-line Konsta message (22px
    // Chat line plus 6px top/bottom padding). At 60px the peak 152% ring fits:
    expect(34 * 1.52).toBeCloseTo(51.68);
    expect((60 - 34 * 1.52) / 2).toBeGreaterThanOrEqual(4);
    for (let distance = 0; distance <= 100; distance += 1) {
      const baseDiameter = Math.max(0, Math.min(34, distance - 8));
      const burstDiameter = Math.max(0, Math.min(51.68, distance - 8));
      // Gap: [bubble right, original bubble right]. Indicator centre is d/2.
      // At d <= 8 it is invisible. Otherwise both ring sizes keep >=4px.
      if (distance > 8) {
        expect((distance - baseDiameter) / 2).toBeGreaterThanOrEqual(4);
        expect((distance - burstDiameter) / 2).toBeGreaterThanOrEqual(4);
      } else {
        expect(baseDiameter).toBe(0);
        expect(burstDiameter).toBe(0);
      }
    }
  });

  it('keeps the white arrow clear of the ring and does not create a Konsta CSS override', () => {
    const icon = css.match(/\.discussion-reply-swipe-indicator__icon\s*\{([^}]+)\}/)?.[1] ?? '';
    expect(icon).toContain('width: min(15px');
    const ringInnerRadius = 15.5 - 2.5 / 2;
    const iconCornerRadius = (15 / 2) * Math.SQRT2;
    expect(ringInnerRadius - iconCornerRadius).toBeGreaterThan(3);
    expect(css).not.toMatch(/\.k-message/);
    expect(css).toContain('background: rgb(42 37 68 / 0.58)');
  });
});
