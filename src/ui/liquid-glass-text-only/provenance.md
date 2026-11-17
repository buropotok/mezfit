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
- A single optional final text action is a non-selectable button. It uses the existing slot styling, participates in scrolling, and never becomes a lens destination; ordinary selectable-slot geometry and motion are unchanged.
- Hidden scenes unmount completely. Runtime listeners, observers, timers, RAFs, and Web Animations are disposed with the scene.

## Public layout options

- `fullWidth` uses the full available host width. Without it the original
  `host / 1.1` inset is preserved.
- `actionTab.widthMultiplier?: 1 | 2` defaults to `1` (original slot).
  `2` doubles the action label's intrinsic width plus its existing horizontal
  padding and border, before the strip's normal flex distribution. It does not
  scale the label, change the 44 px height, or alter selectable-slot optics.
  UIkit measures the label and observes resize/font changes; consumers never
  target private slot CSS. Discussions opts into `2` for its final `+`.
- The final action can be the passive right neighbour for coordinated 300 ms
  auto-scroll. It remains outside selectable indexes and lens destinations.
  Intervening custom categories retain normal immediate-neighbour precedence.

## Completed action click (category dialog regression)

Action touch gestures still use the original 10 px threshold and 140 ms hold
classification. A qualifying pointerup now only arms its completed click; it
never opens an overlay. The pane owns the click listener because pointer capture
can retarget the compatibility click from the action button to the pane. Mouse
clicks and direct button activation share that same action boundary. Scroll,
long-press, cancellation and held-selection releases never arm the action.
Selectable-tab gesture/selection/spring timing is unchanged.

Previously the action opened a new backdrop on pointerup. The suppression
listener on the old action button could not intercept a WebView click retargeted
to that new backdrop, whose ordinary onClick closed the dialog. The new
integration regression models this hit-test sequence with real ShadowRoot,
Dialog, NavigationShell, NavigationSurfaceContext and React commits. It also
checks the pane-targeted capture path and a separate intentional backdrop click.
The two existing assertions requiring action invocation before click were updated
with explicit owner approval (2026-11-18); selection and gesture assertions remain.

jsdom does not implement native touch hit testing, pointer capture or actual flex
layout. Tests supply geometry and explicit event targets; they are regression
models, not physical-device validation. CI runs these checks after PR creation.
Manual acceptance still needs Telegram iOS WKWebView and Android WebView: one
normal tap, typing/saving, separate backdrop/Back/Cancel, repeated taps, action
swipe/hold, and root plus client-scoped Coach/Client screens at narrow widths.
