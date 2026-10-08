import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const bottomSheetCss = readFileSync(
  new URL('./bottom-sheet.css', import.meta.url),
  'utf8',
);

describe('MezfitBottomSheet CSS contract', () => {
  it('opens from the viewport bottom up to the navigation navbar', () => {
    expect(bottomSheetCss).toContain('var(--navigation-navbar-bottom');
    expect(bottomSheetCss).toContain('height: calc(100dvh - var(--navigation-navbar-bottom');
    expect(bottomSheetCss).toContain('z-index: 39 !important');
  });

  it('uses the requested black canvas and the schedule DnD lifted halo', () => {
    expect(bottomSheetCss).toContain('background: #000 !important');
    expect(bottomSheetCss).toContain('0 0 18px rgb(255 255 255 / 0.16)');
    expect(bottomSheetCss).toContain('0 0 36px rgb(170 205 255 / 0.10)');
  });

  it('owns scroll inside the sheet instead of scrolling the panel itself', () => {
    expect(bottomSheetCss).toContain('.ui-mezfit-bottom-sheet__content');
    expect(bottomSheetCss).toContain('overflow-y: auto');
    expect(bottomSheetCss).toContain('overscroll-behavior: contain');
  });
});
