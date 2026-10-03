# Liquid Glass Icon Only

`LiquidGlassIconOnly` always uses the approved center-spread no-FAB reveal and settled tab runtime from `../liquid-glass-tabs-no-fab/`. The obsolete FAB entrance runtime, CSS and startup SVG have been removed.

## Ownership boundaries

- React owns tab identity, labels/icons, controlled selection, and visibility through `hidden`.
- The instance-owned ShadowRoot and private no-FAB runtime own reveal, tab gestures, selector/lens optics and animation cleanup.
- The optional existing FAB primitive is rendered in a separate React-owned sibling wrapper. It is available immediately, independently of the tab reveal. No FAB host or state enters the tab runtime.
- FAB availability changes preserve the same tab scene and in-flight travel, hold release and spring animation. Hide/reveal unmounts and recreates the tab scene with the same no-FAB choreography.
- `fabGeometry.ts` preserves the approved static FAB location, including the 44 px half-slot offset. Its 74% liquid reference size and -26 px Y offset are layout constants only. A wrapper-owned ResizeObserver updates placement when the navigation width changes and disconnects on unmount.
- Tab width remains host width / 1.1. The center-spread reveal preset is documented in `../liquid-glass-tabs-no-fab/provenance.md`.
- Captured pointer release/cancel, lost-pointer-capture cleanup and the tap-spring watchdog remain in the settled runtime for Telegram/WebView callback failures.
- Runtime listeners, observers, RAFs, timeouts and Web Animations are disposed with the scene. Hidden navigation renders neither tabs nor FAB.
