# Liquid Glass Tabs No Fab prototype core

The public React boundary is `LiquidGlassTabsNoFab`: callers provide tabs, controlled selection, `onValueChange`, and `hidden`.

The component deliberately separates the temporary entrance effect from the settled control:

- the settled control is the canonical UI Kit `Tabs theme="liquidGlass" mode="icon"`;
- the private ShadowRoot runtime owns only the center-spread startup liquid field and the handoff;
- the runtime never reimplements tab selection, press, drag, selector, or Konsta/liquidGlass interaction mechanics.

The entrance core is derived from the approved local prototype `tabbar-liquid-tabs-center-spread-v12-timing-baseline.html`. Diagnostic tuner UI, background text/grid, and the standalone replay control are intentionally not part of the component.

## Tuned entrance preset

- pause / first timing point: 0.30 s
- reveal end: 0.75 s
- handoff: 0.16 s
- base speed: 500 px/s
- initial liquid size: 114%
- backdrop blur: 0.7 px
- saturation: 129%
- frost/material: 14%
- speed profile control points: 0, 0.186, 0.360, 0.577, 0

## Entrance behavior

- The startup field is independent from FAB geometry.
- A centered liquid lens expands symmetrically left/right.
- Motion uses the same integrated speed-profile / traveled-distance approach used by the approved prototype.
- Body position, sigma, and bridge weight are derived from the same traveled-distance progress.
- Startup icons receive displacement and saturation without Gaussian blur.
- Background material owns a masked 0.7 px backdrop blur, so icon artwork remains sharp.
- Displacement and reveal alpha share one packed generated map; the bezel is refreshed every other frame.
- During the 0.16 s handoff, the startup layer fades out while the canonical real Tabs wrapper fades in and remains pointer-inert until handoff completes.

## Ownership boundaries

- React owns tab identity, icon sources, controlled value, and visibility.
- UI Kit `Tabs` owns all settled tab mechanics and visuals.
- The private runtime owns only entrance geometry, optical map/bezel rendering, and crossfade timing.
- The startup layer is pointer-inert.
- Hidden scenes unmount completely.
- Width remains responsive: the real Tabs wrapper and startup icon positions both use the host width / 1.1 geometry.
- Runtime RAFs and observers are tracked and disposed with the scene.
