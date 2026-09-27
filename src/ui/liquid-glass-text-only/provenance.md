# Liquid Glass Text Only prototype core

`LiquidGlassTextOnly` is the React/UI-Kit adapter for the approved Text Only liquid-glass prototype fixed on 2026-09-28.

## Fixed geometry and interaction preset

- container height: 44 px
- container width: host width / 1.1, matching `LiquidGlassIconOnly`
- labels: Mezfit Caption token, 12/16, medium 500
- slot width: intrinsic text width + 13 px horizontal padding on each side
- selector inset: 3 px; selector is clipped by the 44 px container mask
- swipe threshold: 10 px
- long-press delay: 140 ms
- selection travel / coordinated auto-scroll / container expansion: 300 ms
- expanded container scale: 1.05
- pressed lens scale: 1.25
- tap spring: 600 ms, using the approved sampled Hermite curve from the prototype
- optical tint: 0.17
- optical blur: 0 px
- optical brightness: 1.02
- bezel opacity: 0.86
- refraction: 8 with RGB spread 0.1

## Approved interaction invariants

- There is no reveal/handoff/entrance animation or entrance configuration.
- Horizontal swipe scrolls the text strip and never selects a tab after the 10 px threshold is crossed.
- Selection travel and any required auto-scroll start in the same frame and finish together after 300 ms.
- Auto-scroll keeps one unselected neighbour visible on the side toward the nearest viewport edge when possible; the first and last slots are the exceptions.
- Selector and tab content are hard-clipped by the 44 px pill. The lens is a sibling overlay and is not clipped by the pill.
- Manual lens dragging is clamped by the centers of the first and last slots; its center cannot travel beyond either edge-slot center.
- The lens is a real capsule, not a vertically scaled oval. Its height grows physically, its horizontal size receives the same radial offset, and its end radius is always half of its height.
- The displacement map is rebuilt from the current capsule geometry so the refractive field follows the actual lens width/height.
- On tap, the arrival phase owns travel, scroll, container expansion, and lens expansion together. The spring begins only after the lens has reached its maximum arrival geometry.
- Hidden scenes unmount completely. Runtime listeners, observers, timers, RAFs, and Web Animations are disposed with the scene.
