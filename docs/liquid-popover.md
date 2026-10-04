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
  trigger={
    <button ref={originRef} style={{ visibility: open ? 'hidden' : undefined }}>
      Действия
    </button>
  }
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
Hide the source through its owner's state while open, retaining its layout.
Navbar exposes `rightControlRef`, `rightControlHidden`, and `renderMenuControl`
for this composition. Existing Navbar press activation remains unchanged through
`triggerActivation="controlled"`; the owner calls `onOpenChange` after its press
animation. Automatic activation is the default for ordinary buttons.

Dimensions come from measured text rows. Shared MezfitPopover retains its
Konsta-derived placement calculation and backdrop dismissal. Native action
buttons own selection and disabled states. No Radix menu is mounted. Long menus scroll at the available
height. No menu action or navigation state is inferred from private DOM.
`items` is deliberately a text/action model, not arbitrary HTML snapshotting.

The default motion is 500 ms plus a 450 ms settling spring. Source compression
runs concurrently for 280 ms, to a 27 px-high capsule with a 35 px spine. The
superellipse has exponent 2.5 and 65% of the target bounding rectangle's area;
its bottom lies 10 px below the rectangle before the final morph. `motion`
accepts partial `LiquidMotionOptions`; times are in seconds, lengths in CSS px,
area/curvature/growth delay are ratios. `LIQUID_POPOVER_DEFAULTS` is exported.

The material is the shared, unmodified `GlassSurface` with preset `frosted` and
`optics={false}`. The animation's content lens has an exactly neutral center and rim distortion
that fades during the final morph. Its distance/normal map stays a Float32Array
and is sampled into the drawing mesh. Canvas renders directly into a bounded
visible surface, with compositor blur. Neither content nor vector maps are PNG
encoded, base64 allocated, or SVG image decoded per frame. This mesh-based
refraction approximates the previous pixel displacement, retaining its flat
center and outward rim stretch. Raster text is prepared
from the action model at one pixel per CSS pixel using the current semantic
body font. Content reaches full opacity halfway, and blur reaches zero only
at the end. The final 10% blends the texture into live HTML using complementary
alpha in an isolated `plus-lighter` group to avoid the source-over brightness
dip. Final content is interactive native HTML.

Closing or unmounting cancels animation work. Viewport/font changes settle to
live content; reduced motion and missing Canvas support skip the effect. UI Kit
includes Navbar and round-button examples with a source compression control.


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
