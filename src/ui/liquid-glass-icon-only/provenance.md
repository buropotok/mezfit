# Liquid Glass Icon Only prototype lineage

The public React component remains `LiquidGlassIconOnly` with the existing controlled selection API. Its private scene is based on the approved liquid-reveal prototype that replaces the previous startup motion while retaining the settled interactive optical tabs behavior.

Current entrance tuning:
- split at 0.35 s;
- reveal duration 1.10 s;
- handoff duration 0.50 s;
- base speed 210 px/s;
- initial lens scale 75%;
- movement delay 0 ms;
- lens blur 0.5 px;
- lens saturation 144%;
- frost/material 14%;
- zero speed at both ends with the approved symmetric three-point speed profile.

Implementation boundary:
- React owns the supplied tab identities, labels, icon artwork, controlled value, and selection callback;
- the private ShadowRoot isolates the animation/prototype CSS and SVG filters;
- the runtime owns only private optical geometry, startup timing, pointer interaction styles, observers, RAFs, timers, and deterministic disposal;
- final tab width remains responsive to the component host (`host.clientWidth / 1.1`), so the liquid target geometry and settled tab geometry share one source of truth;
- startup artwork is a non-interactive visual proxy; the real tab buttons stay mounted, fade in during handoff, and become interactive only after handoff completes;
- hidden unmounts the private scene; a `true -> false` visibility transition plays the entrance once, while an initially visible component settles immediately;
- no iframe, eval, global browser API monkey-patching, or cross-component DOM ownership is introduced.

The reveal uses the same scalar field for mask geometry, refraction direction, and bezel geometry. The bezel render keeps the expanded support bounds from the tuned prototype so the initial circular lens is not clipped by its raster bounding box.
