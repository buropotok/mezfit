# LiquidPopover

Animated presentation for the existing text/action `Menu`. The Navbar only
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

The trigger must forward the Menu's public button props and ref. `triggerRef`
points to the **whole** source surface, which can differ from the trigger itself
(for example, the 88 × 44 Navbar capsule containing the 44 × 44 menu segment).
Hide the source through its owner's state while open, retaining its layout.
Navbar exposes `rightControlRef`, `rightControlHidden`, and `renderMenuControl`
for this composition. Existing Navbar press activation remains unchanged.

Dimensions come from measured text rows; Menu retains placement, collision,
selection, disabled states and dismissal. Long menus scroll at the available
height. No menu action or navigation state is inferred from private DOM.
`items` is deliberately a text/action model, not arbitrary HTML snapshotting.

The default motion is 500 ms plus a 450 ms settling spring. Source compression
runs concurrently for 280 ms, to a 27 px-high capsule with a 35 px spine. The
superellipse has exponent 2.5 and 65% of the target bounding rectangle's area;
its bottom lies 10 px below the rectangle before the final morph. `motion`
accepts partial `LiquidMotionOptions`; times are in seconds, lengths in CSS px,
area/curvature/growth delay are ratios. `LIQUID_POPOVER_DEFAULTS` is exported.

The material is the shared, unmodified `GlassSurface` with preset `frosted` and
`optics={false}`. The animation's separate content lens has a neutral center
and rim distortion that fades during the final morph. Raster text is prepared
from the action model at one pixel per CSS pixel using the current semantic
body font. Content reaches full opacity halfway, and blur reaches zero only
at the end. The final 10% blends the texture into live HTML using complementary
alpha in an isolated `plus-lighter` group to avoid the source-over brightness
dip. Final content is interactive native HTML.

Closing or unmounting cancels animation work. Viewport/font changes settle to
live content; reduced motion and missing Canvas support skip the effect. UI Kit
includes Navbar and round-button examples with a source compression control.
