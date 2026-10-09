# LiquidPopover

Animated text/action presentation hosted by `MezfitPopover`. The Navbar only
supplies its right capsule's ref; it does not own the animation. The same
component accepts a circular or horizontal button as its origin.

```tsx
const originRef = useRef<HTMLButtonElement>(null);
const [open, setOpen] = useState(false);

<LiquidPopover
  isOpen={open}
  onOpenChange={setOpen}
  triggerRef={originRef}
  trigger={<button ref={originRef}>Действия</button>}
  items={[
    { id: 'edit', label: 'Редактировать', onSelect: edit },
    { id: 'copy', label: 'Создать копию', onSelect: copy },
    { id: 'close', label: 'Закрыть', dividerBefore: true,
      onSelect: () => setOpen(false) },
  ]}
/>
```

The trigger must forward normal button props and its ref. `triggerRef`
points to the **whole** source surface, which can differ from the trigger itself
(for example, the 88 × 44 Navbar capsule containing the 44 × 44 menu segment).
LiquidPopover hides its own cloned trigger with `visibility` while opening,
open, and closing, so direct trigger geometry remains measurable. When
`triggerRef` points to a larger surface owned by another component (for
example the Navbar right capsule), LiquidPopover reports the same lifecycle
through `onPresentationChange`; that source owner remains solely responsible
for hiding its surface. The callback returns `false` only after reverse
progress reaches zero.

Route selection is automatic from the measured source and final popover bounds.
If the source lies fully to the left or right of the final popover centerline,
the existing side-entry path is used. If the source's horizontal bounds cross
that centerline, an elongated source first compresses to a circle around its
own center, then takes a strictly vertical main leg. If the source center is
slightly offset from the popover center, the residual horizontal correction is
deferred until the end of that pre-morph route; the normal asymmetric
Apple-style morph then begins from the centered intermediate superellipse. A
source that is already circular skips the empty compression phase and starts
the vertical travel immediately. No route-selection prop is exposed.
Navbar exposes `rightControlRef`, `rightControlHidden`, and `renderMenuControl`
for this composition. Existing Navbar press activation remains unchanged through
`triggerActivation="controlled"`; the owner calls `onOpenChange` after its press
animation. Automatic activation is the default for ordinary buttons.

Dimensions come from measured text rows. Shared MezfitPopover retains its
Konsta-derived placement calculation and backdrop dismissal. Native action
buttons own selection and disabled states. No Radix menu is mounted. Long menus scroll at the available
height. No menu action or navigation state is inferred from private DOM.
`items` is deliberately a typed action model, not arbitrary HTML snapshotting. Each item may include an optional `icon` from the shared `UiIconName` registry. In menu layout the icon is rendered in the leading slot alongside the label, and the opening/closing canvas texture draws a matching tinted icon when its bundled SVG asset has loaded. Grid layout retains text-only cells.

The default opening lasts 650 ms with no spring phase. Source compression runs
for 55 ms toward a 32 px spine. The centered intermediate superellipse has
exponent 2.5 and 35% of the target bounding rectangle's area; growth starts at
31% of the pre-morph phase. The final 510 ms use the reference-derived
asymmetric edge curves: top, bottom, left, and right reach their overshoot at
different times, with the combined geometry peaking at about 106% before
settling continuously to the final rounded rectangle. The morph duration and
106% peak are internal parts of the primitive so the public component API stays
unchanged. Existing `motion` overrides keep the same `LiquidMotionOptions`
shape; `duration` scales the complete opening timeline. Times are in seconds,
lengths in CSS px, and area/curvature/growth delay are ratios.
`LIQUID_POPOVER_DEFAULTS` is exported.

The material is the shared, unmodified `GlassSurface` with preset `frosted` and
`optics={false}`. The animation's content lens has an exactly neutral center and rim distortion
that fades during the final morph. Rim normals and distances are evaluated directly from the current contour
only at the 63 mesh vertices. No pixel distance field, pixel readback, or
per-frame typed-array passes are needed. The blurred content uses a 6 × 8
mesh (at most 96 triangle draws). The raster remains contour-mapped through the
visible overshoot and settle, so it shares the same geometry as the glass shell.
Canvas renders directly into a bounded visible surface, with compositor blur. Neither content nor vector maps are PNG
encoded, base64 allocated, or SVG image decoded per frame. This mesh-based
refraction approximates the previous pixel displacement, retaining its flat
center and outward rim stretch. Raster text is prewarmed from the action model, then repainted at animation
start from the positioned native rows into the final popover viewport. Raster
and live HTML therefore share the same row positions, scroll offset, spacing,
and edge gaps before the mesh deforms that texture. It remains one pixel per
CSS pixel using the current semantic body font. Content opacity, blur,
rim-lens strength, and the raster-to-native handoff are derived from the same
morph timeline. The final 8% blends the contour-mapped
texture into live HTML using complementary alpha in an isolated
`plus-lighter` group; native HTML follows the current asymmetric bounds during
that handoff. Final content is interactive native HTML.

Closing runs the same animation timeline in exact reverse from the current
progress back to zero: native HTML hands back to the raster, the asymmetric
popover geometry contracts through the same oval/path, and an elongated
center-route source expands from the terminal circle back into its original
button shape. The presentation snapshot (items, layout, material, motion
options, source/destination bounds, and active raster texture) is frozen for the
whole animation session, so navigation/role changes cannot replace content or
geometry mid-reverse. The direct trigger remains hidden until the reverse
reaches zero, while external source owners receive the same timing through
`onPresentationChange`. Reopening during a close reverses again from the
current progress instead of jumping to an endpoint. Unmounting
cancels animation work. Viewport/font changes settle to the requested endpoint;
reduced motion and missing Canvas support skip the effect. UI Kit includes
Navbar and round-button examples with a source compression control.


## Shared presentation contract

`MezfitPopover` now exposes `presentation="custom"` and `portal` (both opt-in).
Custom presentation keeps the existing position calculation, virtual target
props, resize handling, backdrop and callback. Its app-owned children provide
all chrome and opening animation, so it adds neither another GlassSurface nor
the standard scale/translation. Closed custom content is hidden. `onPositioned` signals a committed placement;
LiquidPopover waits for it before starting the animation. Standard mode
and its existing iOS/material presentation remain the default.

LiquidPopover uses these public Mezfit APIs. It does not style private Konsta
nodes, copy a new placement/dismissal engine, or change any library files. The
content SVG only supplies a clipping contour; there are no SVG image filters.

## iOS Canvas clipping

`LiquidPopover` defaults to `renderMode="auto"`. It uses in-Canvas
`Path2D` clipping on iPhone/iPad (including iPadOS desktop user-agent mode),
detected from the browser and Telegram's `WebApp.platform`. Other platforms
retain the existing SVG `clip-path` on the visible Canvas. This changes only
how the already-rendered texture is masked; geometry, timing, GlassSurface,
native menu actions, placement, dismissal and close/reverse behavior remain
shared.

The optional `renderMode="svg" | "canvas"` override is intended for
controlled diagnostics, not as a user preference. Settings → Modules displays
two identical real menus with the respective modes forced, even on the same
device. The UI Kit → Liquid Popover catalog additionally presents the same
round-button menu in Auto, SVG and Canvas modes. Each example is independent,
shares the source-morph slider, and shows the platform-resolved Auto mode.
Missing Canvas/`Path2D` support still follows the existing native
content fallback. The iOS workaround does not affect the Konsta package.
