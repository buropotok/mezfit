# Mezfit UI Kit

## Purpose

The UI Kit is the code-level implementation of Mezfit's design system. It is intentionally small and incremental: existing feature screens are migrated only when they are being changed for product work.

## Layer model

`Radix behavior -> Mezfit tokens/primitives/components -> feature UI`

- **Radix Primitives** provide mature headless interaction infrastructure for complex widgets: accessibility, focus management, keyboard behavior, portals and overlay mechanics where applicable.
- **Tokens** define reusable visual decisions and semantic aliases over the existing theme contract.
- **Primitives** are small accessible React building blocks with no Mezfit domain logic.
- **Components** compose primitives and, where appropriate, Radix primitives into reusable interaction patterns such as Menu, ListItem, Modal, BottomSheet and SegmentedControl.
- **Feature UI** owns product/domain behavior and composes the layers above it.

`src/ui` must not depend on coach/client feature modules. Feature code must not import Radix directly when a Mezfit UI Kit abstraction exists.

## Interaction infrastructure rule

Do not reimplement mature interaction infrastructure such as dialog focus traps, nested overlay coordination, Escape handling, scroll locking or screen-reader semantics when Radix provides the corresponding primitive. Mezfit wraps Radix behind its own stable component API.

Radix controls behavior; Telegram Web A is the visual/UX reference; Mezfit tokens map that presentation onto the application theme. This keeps Telegram styling without inheriting or maintaining Telegram's application-specific interaction machinery.

## Public API

Feature code imports supported UI from `src/ui` rather than reaching into implementation files or importing the underlying Radix primitive directly.

## Tokens

Tokens live in `src/ui/tokens`. Theme colors are semantic aliases over the canonical `--theme-*` variables in `src/theme.css`; the UI Kit does not create a competing theme system.

Feature CSS must not redefine an established UI Kit radius, shadow, control state, typography role or motion value with an arbitrary literal when the corresponding token/component already exists.

Glass is a shared UI Kit material defined by semantic effect tokens in `src/ui/tokens/effects.css`. Components expose `theme="glass"`; consumers do not configure blur, border, opacity or shadow values per instance. Component geometry remains component-owned even when the material is shared.

`liquidGlass` is a separate UI Kit visual theme for approved glass/refraction interactions. Its SVG displacement, blur/fallback behavior and motion presets are component-owned implementation details. Consumers select the theme but do not retune its optics or spring physics per screen.

## Foundation primitives

- `Text`
- `Button`
- `Icon`
- `IconButton`
- `Avatar`
- `Divider`
- `Surface`

Interactive primitives expose visible keyboard focus, native disabled behavior where applicable, and accessible names for icon-only controls. Reduced-motion preferences are respected.

### Named icon API

Reusable UI artwork is registered inside `src/ui/icons` and consumed through the public `Icon` API by stable name. Consumers pass the icon name and, when needed, `outline` or `filled` variant; they do not import the underlying SVG asset path directly. Components that accept selectable icon artwork, including `IconButton`, `TabsTrigger`, `LiquidGlassIconOnly`, and `IdentityAction`, accept registered icon names and resolve the artwork internally.

The registry is the asset boundary: changing the SVG mapped to a registered name updates every consumer without feature-level import changes. Existing explicit React-element icon pairs remain accepted where required for backwards compatibility, but new product navigation and reusable UI should use registered names.

`IconButton` and `Surface` support `theme="default" | "glass" | "liquidGlass"`; omitted theme means the existing default presentation. Glass and liquidGlass are owning materials rather than additive visual modifiers: their border, background, blur/refraction and shadow are fixed by UI Kit and must not be silently overridden by instance props.

For `Surface`, `border` and `elevated` belong only to the default theme. `Surface theme="glass"` and `Surface theme="liquidGlass"` therefore reject both props at the TypeScript contract level because the selected material already owns its border and shadow.

For `IconButton`, the existing `color`, `selected`, and `shadow` APIs remain unchanged under `theme="default"`. Under `theme="glass"` or `theme="liquidGlass"`, `color` and `shadow` are not valid because they would conflict with the material. A controlled `selected` state is supported together with either a registered icon name or a backwards-compatible explicit `{ outline, filled }` icon pair; selection swaps outline to filled artwork and runs the shared spring motion while the material presentation remains component-owned.

### Telegram Web A button provenance

`Button` and `IconButton` use Telegram Web A as their interaction and geometry reference. Upstream: `Ajaxy/telegram-tt/src/components/ui/Button.scss` and `src/styles/_variables.scss`. Telegram color roles map to Mezfit semantic theme tokens.

## Tabs variants

`Tabs` remains backed by Radix Tabs and has two independent variant axes:

- `theme?: "default" | "glass" | "liquidGlass"` controls the visual material. Omitted means the current default Tabs presentation.
- `mode?: "default" | "icon"` controls trigger composition. Omitted means the current text-only trigger. Icon mode makes the trigger taller and places a 24px icon above the existing Body 15/20 medium label.

When `mode="icon"`, every `TabsTrigger` requires registered icon artwork, normally supplied by icon name; explicit `{ outline, filled }` pairs remain supported for backwards compatibility. Inactive triggers show outline artwork. The selected trigger shows filled artwork. Radix remains the state/accessibility owner. Default/glass keep the existing press/spring behavior; liquidGlass owns its approved lens/container/icon motion sequence inside the UI Kit.

For `theme="liquidGlass"`, the springing/scaling target is the UI-Kit-owned visual layer around `TabsList` and its external press lens. `TabsContent` is explicitly outside that visual layer and must never participate in container expansion or spring transforms.

The product integration contract is separate from the primitive mechanics: when liquidGlass Tabs are used as Mezfit's app-wide quick navigation, they are mounted by the application/navigation shell as a persistent overlay above page content, alongside other shell-owned controls such as FABs. The Tabs primitive itself does not portal or choose global positioning; shell code owns safe-area placement, stacking and route persistence.

Theme and mode compose freely, including `theme="glass" mode="icon"` and `theme="liquidGlass" mode="icon"`. The internal `/ui-kit` catalog shows default, glass and liquidGlass specimens for both text/default and icon modes.

## Telegram-derived contact UI

The contact/client-list presentation is adapted from Telegram Web A at commit `9cb10b20797dc09e33fcffee0ba390bb429c66d3`:

- `List` / `ListItem`: `src/components/ui/ListItem.tsx`, `ListItem.scss`, with the contact-list usage in `src/components/left/main/ContactList.tsx`.
- `FloatingActionButton`: `src/components/ui/FloatingActionButton.tsx` and `.scss`. The upstream positioning (`right: 1rem`, `bottom: 1rem`) and reveal transition are preserved. Mezfit keeps icon content caller-provided so the existing icon source remains canonical.
- `Modal`: behavior is backed by Radix Dialog. Telegram Web A `src/components/ui/Modal.scss` remains the visual reference for the centered overlay, 25% black backdrop, dialog width constraints and header/content geometry. Focus trapping, Escape behavior, nested-dialog coordination, accessibility semantics, portal behavior and scroll locking belong to Radix rather than Mezfit application code.

These components contain no coach/client domain behavior. The production client directory will compose them separately: client rows use `ListItem`, add-client uses `FloatingActionButton`, and invitation content uses `Modal`.

## Internal catalog

`/ui-kit` is a development/internal visual contract showing supported primitives and components. It is intentionally absent from product navigation and contains no domain state.

## Migration strategy

Do not mass-refactor existing screens. New UI should prefer the UI Kit. Existing UI moves into it opportunistically when touched by scoped work. The client-list production migration is deliberately separate from this component-foundation change.
