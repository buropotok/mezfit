# `src/ui`

Public UI Kit imports should come from `src/ui/index.ts`.

- `tokens/` — design tokens and semantic theme aliases
- `primitives.tsx` — foundational accessible primitives
- `components.tsx` — composed interaction components; use mature Radix primitives for behavior when available and map Telegram Web A source-level visuals onto Mezfit semantic tokens
- `UiKitPage.tsx` — internal `/ui-kit` visual catalog

Feature/domain modules must not be imported into this directory. Feature code should consume the Mezfit wrappers rather than importing Radix directly when a wrapper exists.
