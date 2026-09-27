# Liquid Glass Icon Only prototype core

The public React boundary remains `LiquidGlassIconOnly`: callers still provide tabs, controlled selection, and `hidden`. The component may additionally receive an optional FAB node; when supplied, the same startup liquid field grows into the tabs container while the detached round lens follows the approved contour trajectory and hands off to the real FAB.

The current startup core is derived from the approved local prototypes used during visual tuning. The settled tab interaction runtime remains isolated in the component ShadowRoot; the entrance layer is temporary and becomes non-interactive after handoff.

## Tuned entrance preset

- split: 0.25 s
- reveal: 0.65 s
- handoff: 0.22 s
- base speed: 290 px/s
- initial lens size: 74%
- start delay: 0 ms
- FAB Y offset: -26 px
- lens blur: 0.5 px
- saturation: 124%
- frost/material: 13%
- speed profile control points: 0, 0.186, 0.360, 0.577, 0

The upper lens starts moving 100 ms before split when a FAB target exists. Its X progress uses the tuned smooth curve while Y is derived from the current upper contour of the lower liquid field, preserving a small overlap until handoff. During handoff the upper lens eases down to the 56 px FAB diameter while optical strength and opacity fade.

## Adapter boundaries

- React owns tab identity, labels/icons, controlled value, the optional real FAB node, and mount/unmount through `hidden`.
- The private runtime owns entrance geometry, displacement/mask/bezel rendering, the liquid-to-real crossfade, and the existing tab gesture optics.
- The real FAB primitive is not restyled by the runtime. The runtime only positions and fades its app-owned wrapper.
- Runtime listeners, observers, RAFs, timeouts, and Web Animations are tracked and disposed with the scene.
- Width remains responsive: the final tabs width is derived from the host width / 1.1 and is shared by both the entrance geometry and the settled tabs.
- The entrance layer is pointer-inert. Tabs and FAB become interactive only after handoff completes.
- Hidden scenes unmount completely.
