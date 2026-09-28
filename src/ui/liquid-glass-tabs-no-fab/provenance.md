# Liquid Glass Tabs No Fab prototype core

The public React boundary is `LiquidGlassTabsNoFab`: callers provide tabs, controlled selection, and `hidden`. React owns identity and rendering; a private ShadowRoot runtime owns the approved center-spread entrance, handoff, and settled icon-tab gesture optics.

The entrance core is derived from the approved local prototype `tabbar-liquid-tabs-center-spread-v12-timing-baseline.html`. Diagnostic tuner UI, test background text/grid, and the standalone replay control are intentionally not part of the component.

## Tuned entrance preset

- pause before reveal: 0.30 s
- reveal: 0.75 s
- handoff: 0.16 s
- initial lens size: 114%
- saturation: 129%
- frost/material: 14%
- speed profile control points: 0, 0.186, 0.360, 0.577, 0

The entrance begins as one centered liquid lens. Two symmetric field centers move apart horizontally using the same integrated speed-profile approach used by `LiquidGlassIconOnly`. Field sigma, bridge weight, mask, displacement map, and bezel are derived from the actual separation so geometry and optics stay synchronized. The final liquid surface crossfades to the settled interactive tabs during handoff.

## Adapter boundaries

- React owns tab identity, labels/icons, controlled value, and mount/unmount through `hidden`.
- The private runtime owns entrance geometry, displacement/mask/bezel rendering, the liquid-to-real crossfade, and the existing icon-tab gesture optics.
- The settled interaction model is intentionally kept equivalent to `LiquidGlassIconOnly`.
- Runtime listeners, observers, RAFs, timeouts, and Web Animations are tracked and disposed with the scene.
- Width remains responsive: final tabs width is derived from host width / 1.1 for both entrance and settled tabs.
- The entrance layer is pointer-inert. Tabs become interactive only after handoff completes.
- Hidden scenes unmount completely.
