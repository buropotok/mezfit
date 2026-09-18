# `src/ui`

Public UI Kit imports should come from `src/ui/index.ts`.

- `tokens/` — design tokens and semantic theme aliases
- `primitives.tsx` — foundational accessible primitives
- `components.tsx` — composed interaction components; use mature Radix primitives for behavior when available and map Telegram Web A source-level visuals onto Mezfit semantic tokens
- `UiKitPage.tsx` — internal `/ui-kit` visual catalog

`List` owns row-divider presentation through its public `divider` prop: `none` (default), `inset`, or `full`. `ListItem` keeps passive row content in `trailing`; use `trailingAction` for an independent interactive control/menu that must remain outside the row button. UI Kit owns the alignment and spacing between both slots. Feature CSS must not target `ListItem` internal wrappers such as `.ui-list-item-wrap` to draw separators or place trailing actions.

`FloatingActionButton` owns canonical interactive text typography (Body 15/20, medium 500) and foreground color. Pass plain text for textual FAB labels so it inherits the FAB contract; artwork children remain caller-provided.

Feature/domain modules must not be imported into this directory. Feature code should consume the Mezfit wrappers rather than importing Radix directly when a wrapper exists.
