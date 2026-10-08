import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const bottomSheetCss = readFileSync(
  new URL('./bottom-sheet.css', import.meta.url),
  'utf8',
);

describe('MezfitBottomSheet CSS contract', () => {
  it('keeps the sheet below the navbar halo boundary while staying above schedule controls', () => {
    expect(bottomSheetCss).toContain('--ui-mezfit-bottom-sheet-halo-clearance: 36px');
    expect(bottomSheetCss).toContain('var(--navigation-navbar-bottom');
    expect(bottomSheetCss).toContain('var(--ui-mezfit-bottom-sheet-halo-clearance)');
    expect(bottomSheetCss).toContain('height: calc(100vh - var(--navigation-navbar-bottom');
    expect(bottomSheetCss).toContain('height: calc(100dvh - var(--navigation-navbar-bottom');
    expect(bottomSheetCss).toContain('max-height: calc(100vh - var(--navigation-navbar-bottom');
    expect(bottomSheetCss).toContain('max-height: calc(100dvh - var(--navigation-navbar-bottom');
    expect(bottomSheetCss).toContain('z-index: 39 !important');
    expect(bottomSheetCss).toContain('width: calc(100vw - var(--k-safe-area-left, 0px) - var(--k-safe-area-right, 0px))');
    expect(bottomSheetCss).toContain('max-width: 720px');
    expect(bottomSheetCss).toContain('margin-inline: auto');
  });

  it('uses the requested opaque black canvas and the schedule DnD lifted halo without a dimming backdrop', () => {
    expect(bottomSheetCss).toContain('background: #000 !important');
    expect(bottomSheetCss).toContain('border-radius: var(--ui-radius-md) var(--ui-radius-md) 0 0 !important');
    expect(bottomSheetCss).toContain('0 0 18px rgb(255 255 255 / 0.16)');
    expect(bottomSheetCss).toContain('0 0 36px rgb(170 205 255 / 0.10)');
    expect(bottomSheetCss).not.toContain('backdrop');
  });

  it('owns scroll inside the sheet instead of scrolling the panel itself', () => {
    expect(bottomSheetCss).toContain('.ui-mezfit-bottom-sheet__content');
    expect(bottomSheetCss).toContain('overflow-y: auto');
    expect(bottomSheetCss).toContain('overscroll-behavior: contain');
  });
});
