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

Feature code imports supported primitives from `src/ui` rather than reaching into primitive implementation files. Internal files may change without becoming application-wide contracts.

## Tokens

Tokens live in `src/ui/tokens`. Theme colors are semantic aliases over the canonical `--theme-*` variables in `src/theme.css`; the UI Kit does not create a competing theme system.

A value belongs in tokens when it represents a reusable design decision shared by multiple primitives/components: semantic color roles, spacing steps, typography, radii, elevation, motion or layering.

A value stays component-local when it is intrinsic to that component and has no established cross-component meaning. Do not promote one-off measurements into global tokens pre-emptively.

Feature CSS must not redefine an established UI Kit radius, shadow, control state, typography role or motion value with an arbitrary literal when the corresponding token/component already exists.

## Foundation primitives

PR 1 establishes:

- `Text`
- `Button`
- `IconButton`
- `Avatar`
- `Divider`
- `Surface`

Primitives use native HTML semantics by default. Interactive primitives must expose visible keyboard focus, native disabled behavior where applicable, and accessible names for icon-only controls. Reduced-motion preferences are respected.

The existing Mezfit icon source remains canonical; the UI Kit must not introduce a parallel icon library.

### Telegram Web A button provenance

`Button` and `IconButton` use Telegram Web A as their interaction and geometry reference. The upstream sources are `Ajaxy/telegram-tt/src/components/ui/Button.scss` and `Ajaxy/telegram-tt/src/styles/_variables.scss`.

The port preserves the upstream 3rem standard height, 1rem standard button radius, uppercase label treatment, 0.5rem base padding, fluid horizontal padding of 1.75rem, medium weight, 1.2 line-height, 0.2s color/background/opacity transitions, disabled opacity 0.5, and round 3rem icon-button geometry. Telegram color roles are mapped to Mezfit semantic theme tokens rather than copied as a parallel theme system.

## Internal catalog

`/ui-kit` is a development/internal visual contract showing supported primitive states. It is intentionally absent from client and coach navigation.

The catalog is not a second application and must contain no domain state. It exists to review component states, theme compatibility and regressions in one place.

## Migration strategy

Do not mass-refactor existing screens. New UI should prefer the UI Kit. Existing UI moves into it opportunistically when touched by scoped work.

The next planned extraction is the Telegram-derived navigation menu: its presentation and interaction primitives should become reusable `Menu` / `MenuItem` components while `NavigationShell` retains Mezfit routing, account and role behavior.
