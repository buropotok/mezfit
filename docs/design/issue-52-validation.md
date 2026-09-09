# Issue #52 validation

- Drawer open: 220 ms, `cubic-bezier(0.2, 0, 0, 1)`.
- Drawer close: 180 ms, `cubic-bezier(0.4, 0, 1, 1)`.
- Backdrop opacity transitions with the panel.
- Closing backdrop stops accepting pointer input while the exit animation completes.
- `prefers-reduced-motion: reduce` reduces transitions to 1 ms.
- Drawer stays mounted for the exit transition and restores focus to the global menu button afterward.
- Escape, backdrop, destination selection and role switching preserve their close paths.
- Drawer icons use 24 px slots; app-bar icons render at 22 px inside 44×44 targets.
- APK PNG alpha masks inherit `currentColor`, including active accent and all global theme text colors.
- Temporary navigation Unicode glyphs are guarded by a source-level regression test.
