# Mezfit UI Kit

## Purpose

The UI Kit is the code-level implementation of Mezfit's design system. It is intentionally small and incremental: existing feature screens are migrated only when they are being changed for product work.

## Layer model

`tokens -> primitives -> components -> feature UI`

- **Tokens** define reusable visual decisions and semantic aliases over the existing theme contract.
- **Primitives** are small accessible React building blocks with no Mezfit domain logic.
- **Components** compose primitives into reusable interaction patterns such as Menu, ListItem, Modal, BottomSheet and SegmentedControl.
- **Feature UI** owns product/domain behavior and composes the layers above it.

Dependencies flow only from right to left in that list. `src/ui` must not depend on coach/client feature modules.

## Public API

Feature code imports supported UI from `src/ui` rather than reaching into implementation files.

## Tokens

Tokens live in `src/ui/tokens`. Theme colors are semantic aliases over the canonical `--theme-*` variables in `src/theme.css`; the UI Kit does not create a competing theme system.

Feature CSS must not redefine an established UI Kit radius, shadow, control state, typography role or motion value with an arbitrary literal when the corresponding token/component already exists.

## Foundation primitives

- `Text`
- `Button`
- `IconButton`
- `Avatar`
- `Divider`
- `Surface`

Interactive primitives expose visible keyboard focus, native disabled behavior where applicable, and accessible names for icon-only controls. Reduced-motion preferences are respected. The existing Mezfit icon source remains canonical.

### Telegram Web A button provenance

`Button` and `IconButton` use Telegram Web A as their interaction and geometry reference. Upstream: `Ajaxy/telegram-tt/src/components/ui/Button.scss` and `src/styles/_variables.scss`. Telegram color roles map to Mezfit semantic theme tokens.

## Telegram-derived contact UI

The contact/client-list building blocks are source-level adaptations of Telegram Web A at commit `9cb10b20797dc09e33fcffee0ba390bb429c66d3`:

- `List` / `ListItem`: `src/components/ui/ListItem.tsx`, `ListItem.scss`, with the contact-list usage in `src/components/left/main/ContactList.tsx`.
- `FloatingActionButton`: `src/components/ui/FloatingActionButton.tsx` and `.scss`. The upstream positioning (`right: 1rem`, `bottom: 1rem`) and reveal transition are preserved. Mezfit keeps icon content caller-provided so the existing icon source remains canonical.
- `Modal`: `src/components/ui/Modal.tsx` and `.scss`. The Mezfit React adaptation preserves the centered fixed overlay, 25% black backdrop, Telegram dialog width constraints, header/content geometry, Escape/backdrop close behavior, focus containment, focus restoration and body scroll lock.

These components contain no coach/client domain behavior. The production client directory will compose them separately: client rows use `ListItem`, add-client uses `FloatingActionButton`, and invitation content uses `Modal`.

## Internal catalog

`/ui-kit` is a development/internal visual contract showing supported primitives and components. It is intentionally absent from product navigation and contains no domain state.

## Migration strategy

Do not mass-refactor existing screens. New UI should prefer the UI Kit. Existing UI moves into it opportunistically when touched by scoped work. The client-list production migration is deliberately separate from this component-foundation change.
