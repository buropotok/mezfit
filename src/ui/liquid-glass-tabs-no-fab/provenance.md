# Liquid Glass Tabs No Fab prototype core

`LiquidGlassTabsNoFab` is derived directly from the current `LiquidGlassIconOnly` component architecture.

The intentional differences are only:

- the FAB prop/host/geometry are removed;
- the original reveal animation is replaced with the approved center-spread reveal from `tabbar-liquid-tabs-center-spread-v12-timing-baseline.html`;
- startup background blur is separated from icon optics, so startup icons keep displacement/saturation without Gaussian blur.

Everything after handoff remains the same private settled tabs implementation used by `LiquidGlassIconOnly`: the same ShadowRoot structure, selector/lens mechanics, touch interaction, active-icon spring, controlled React selection bridge, lifecycle, and cleanup behavior.

## Tuned reveal preset

- pause / first timing point: 0.30 s
- reveal end: 0.75 s
- handoff: 0.16 s
- base speed: 500 px/s
- initial liquid size: 114%
- backdrop blur: 0.7 px
- saturation: 129%
- frost/material: 14%
- speed profile control points: 0, 0.186, 0.360, 0.577, 0

## Ownership boundaries

- React owns tab identity, icon sources, controlled value, `onValueChange`, and `hidden`.
- The private runtime is the same settled interaction runtime as `LiquidGlassIconOnly`.
- The center-spread reveal is temporary and hands off to that settled runtime.
- No FAB state, host, geometry, timing, or API exists in this component.
- Hidden scenes unmount completely.
- Runtime timers, RAFs, observers, animations, and listeners are disposed with the scene.
