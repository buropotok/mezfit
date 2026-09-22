# `src/ui`

Public UI Kit imports should come from `src/ui/index.ts`.

- `tokens/` — design tokens and semantic theme aliases
- `primitives.tsx` — foundational accessible primitives
- `components.tsx` — composed interaction components; use mature Radix primitives for behavior when available and map Telegram Web A source-level visuals onto Mezfit semantic tokens
- `UiKitPage.tsx` — internal `/ui-kit` visual catalog

`List` owns row-divider presentation through its public `divider` prop: `none` (default), `inset`, or `full`. `ListItem` keeps passive row content in `trailing`; use `trailingAction` for an independent interactive control/menu that must remain outside the row button. UI Kit owns the alignment and spacing between both slots. Feature CSS must not target `ListItem` internal wrappers such as `.ui-list-item-wrap` to draw separators or place trailing actions.

`FloatingActionButton` owns canonical interactive text typography (Body 15/20, medium 500) and foreground color. Pass plain text for textual FAB labels so it inherits the FAB contract; artwork children remain caller-provided.

`--ui-color-modal` is the semantic overlay-surface color and maps to the theme-owned `--theme-modal` token. `Modal` always uses it. `BottomSheet` uses it by default through `modalColor={true}`; set `modalColor={false}` only when the sheet intentionally needs the ordinary surface color. `BottomSheet.inset` is the UI Kit-owned floating-sheet geometry: about 12px horizontal/bottom inset, full corner rounding, and safe-area-aware bottom placement; the default remains edge-to-edge at the bottom. `BottomSheet.headerLeading` is the public slot for a caller-owned leading navigation/action control while UI Kit keeps header layout ownership. `BottomSheet.floatingAction` places workflow actions outside the scrollable content while keeping them inside the sheet panel and above the bottom safe area. Feature code must not hard-code modal/sheet colors, margins, or target BottomSheet internals.

Feature/domain modules must not be imported into this directory. Feature code should consume the Mezfit wrappers rather than importing Radix directly when a wrapper exists.
