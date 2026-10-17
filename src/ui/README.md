# `src/ui`

Public UI Kit imports should come from `src/ui/index.ts`.

- `tokens/` — design tokens and semantic theme aliases
- `primitives.tsx` — foundational accessible primitives
- `components.tsx` — composed interaction components; use mature Radix primitives for behavior when available and map Telegram Web A source-level visuals onto Mezfit semantic tokens
- `UiKitPage.tsx` — internal `/ui-kit` visual catalog

`List` owns row-divider presentation through its public `divider` prop: `none` (default), `inset`, or `full`. `ListItem` keeps passive row content in `trailing`; use `trailingAction` for an independent interactive control/menu that must remain outside the row button. UI Kit owns the alignment and spacing between both slots. Feature CSS must not target `ListItem` internal wrappers such as `.ui-list-item-wrap` to draw separators or place trailing actions.

`FloatingActionButton` owns canonical interactive text typography (Body 15/20, medium 500) and foreground color. Pass plain text for textual FAB labels so it inherits the FAB contract; artwork children remain caller-provided.

`--ui-color-modal` is the semantic overlay-surface color and maps to the theme-owned `--theme-modal` token. `Modal` always uses it. `BottomSheet` uses it by default through `modalColor={true}`; set `modalColor={false}` only when the sheet intentionally needs the ordinary surface color. `BottomSheet.inset` is the UI Kit-owned floating-sheet geometry: about 12px horizontal/bottom inset, full corner rounding, and safe-area-aware bottom placement; the default remains edge-to-edge at the bottom. `BottomSheet.headerLeading` is the public slot for a caller-owned leading navigation/action control while UI Kit keeps header layout ownership. `BottomSheet.floatingAction` places workflow actions outside the scrollable content while keeping them inside the sheet panel and above the bottom safe area. Feature code must not hard-code modal/sheet colors, margins, or target BottomSheet internals.


`LiquidGlassIconOnly` is a standalone icon-only navigation primitive. It does not compose or inherit `Tabs`, `TabsList`, `TabsTrigger`, or `LiquidGlassTabs`. Its public contract is `tabs`, `value`, `onValueChange`, and `hidden`; each tab supplies its own `label` plus outline/filled icon pair. Slot geometry is derived from `tabs.length`. `hidden={true}` removes the primitive from view immediately, while only the transition from `true` to `false` plays the approved reveal animation. Mounting with `hidden={false}` starts directly in the final interactive state. The primitive owns its reveal, hold/drag lens, container scaling, highlight, spring, and optical refraction mechanics internally.

Feature/domain modules must not be imported into this directory. Feature code should consume the Mezfit wrappers rather than importing Radix directly when a wrapper exists.

Import `LiquidGlassIconOnly` directly from `./LiquidGlassIconOnly` (its types remain exported by the UI barrel). The icon-only primitive directly hosts the approved HTML mechanics in an instance-owned ShadowRoot. Supply inline SVG or self-styled icon elements: document CSS classes cannot cross this style boundary. Implementation provenance and lifecycle adaptations are recorded in `liquid-glass-icon-only/provenance.md`. The `/ui-kit` catalog includes coach/client sets and is loaded on demand.

`DatePicker` is the canonical shared date-only picker. It composes Konsta `Panel`, `Navbar`, `Glass`, `Popover`, `Button`, and `Link` primitives with app-owned calendar grids and scroll layout. Its public value is `LocalDate` in `YYYY-MM-DD` form; timezone-bearing `Date` objects are intentionally not part of the picker contract. The default year range is 1950–2049. Do not reintroduce DayPicker or a second calendar picker for feature-specific flows; feature screens own only the trigger and selected date state.

`TimePicker` is the canonical shared local-time picker. It uses `MezfitPopover` for anchored overlay mechanics, app-owned hour/minute scroll ribbons, and the approved `LiquidGlassTextOnly` shell. Its public value is strict local `HH:mm`. Lens mode defaults to `auto`: iOS devices use scale-based magnification because SVG displacement is unreliable in iOS WebView, while other platforms retain the two-stage displacement lens. `lensMode="ios"` and `lensMode="displacement"` are explicit UI Kit overrides for diagnostics/specimens. `MezfitPopover.iosHighlight` is the supported opt-out for the Konsta iOS radial press highlight; TimePicker disables it instead of styling Konsta internals.

`NumPicker` is the numeric sibling of `TimePicker` for integer values 0–399. Both primitives share the same internal two-column wheel/lens mechanics, `MezfitPopover`, automatic iOS scale fallback / non-iOS displacement lens, and Telegram selection haptic boundary. NumPicker displays an empty hundreds slot for 0–99, then `1`–`3` for 100–399, while its right ribbon displays `00`–`99`.

### SpeechCloud

`SpeechCloud` is a controlled coach speech primitive built on Liquid Popover's
motion geometry, text rasterizer and Canvas mesh. It deliberately stops at the
superellipse; the existing LiquidPopover contract and renderer are unchanged.

```tsx
<SpeechCloud
  isOpen={hintOpen}
  onOpenChange={setHintOpen}
  text="Начнём с разминки"
  avatar={<Avatar name="Тренер" src={coach.avatarUrl} />}
/>
```

Pass the actual circular avatar through `avatar`: SpeechCloud owns a separate
inline wrapper, so it can animate without changing or copying the avatar's DOM.
The surrounding layout must allow the avatar's scale to overflow. The opening
pulse is 1 → 1.5 over 100ms, hold for 200ms, then 1.5 → 1 over 100ms. Interrupted
closing restores scale smoothly; reopening starts a new pulse. Reduced motion
settles immediately without the pulse.

Public defaults: `maxWidth={300}`, `durationMs={400}`,
`tailDurationMs={250}`, `tailDelayMs={200}`, `tailBend={12}`. Durations are in
milliseconds; the tail delay is measured from the overall animation start.
The tail bends away from the cloud center, clockwise in symmetric positions.
`text` is plain text, with browser wrapping and explicit line breaks preserved.
Short replies shrink; long replies wrap and scroll within the safe inner area.

Placement selects available space around the avatar, reserves its 150% size,
and respects viewport safe areas. Optionally pass `availableArea` with
`{left, top, width, height}` in viewport CSS pixels to exclude important UI such
as a Navbar. Geometry stays fixed during normal animation; viewport changes,
ancestor scroll, font loading and anchor resizing recalculate placement.

The portal dims the screen with a live elliptical hole around the transformed
avatar. White cloud and tail remain above the dimmer. Tapping the backdrop
requests `onOpenChange(false)`; the caller owns whether the cloud is open.
The final cloud uses semantic Body text. During motion, the shared rasterizer
paints those same DOM glyph positions into the shared warped Canvas mesh, with
in-Canvas clipping for WebKit. If Canvas is unavailable, HTML appears when the
body settles. No business storage, timers or global subscriptions exist while
closed. The UI Kit catalogue includes an editable demonstration.
