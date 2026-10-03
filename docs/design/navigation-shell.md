# Mezfit navigation shell

Status: canonical UI contract for global navigation.

This contract is governed together with `docs/design/platform-ui-policy.md` and `docs/design/ui-spec-v1.md`.

## Ownership

`NavigationShell` owns application navigation infrastructure: active first-level destination, nested navigation context, browser history integration, Telegram BackButton integration, role switching, and the globally readable navigation level.

`MezfitNavbar` owns navbar presentation and navbar-only motion. It must not infer application navigation from DOM state or browser history.

The application has two navigation levels:

- level 1 — a first-level application destination selected by the bottom Tabs control;
- level 2 — a contextual entity/detail surface with Back navigation.

The global navigation level is authoritative application/navigation state. Navbar offsets, visibility and animation progress are derived presentation state and must not be stored globally.

## MezfitNavbar

The production navbar is `MezfitNavbar`, composed through the public Konsta UI `Navbar` API.

Konsta owns Navbar safe-area, sticky positioning and library mechanics. Mezfit supplies app-owned children inside the public `children` extension point. Do not patch Konsta source, target private `.k-*` selectors, or wrap Mezfit actions in the Konsta `left`/`right` Glass slots.

The navbar contains three persistent visual regions:

1. left Back `IdentityAction`;
2. central labeled `IdentityAction` describing the current page/entity;
3. right double `IdentityAction` containing calendar on the left and contextual page menu on the right.

All navbar actions consume the shared navbar GlassSurface preset. The default preset is configured in `src/ui/mezfitNavbarConfig.ts`; individual navbar instances may explicitly override it when a product requirement needs that.

### Level 1

The Back action is non-interactive and positioned beneath the central identity action.

The central identity displays the selected first-level destination title and destination icon. Its action surface is capped at 224px and centered in the free horizontal interval between the 44px Back action slot and the 88px Menu/Calendar action slot. It preserves at least 16px clearance from each side action by shrinking only when that interval is narrower than 224px.

The bottom `LiquidGlassIconOnly` control owns first-level destination selection. `NavigationShell` keeps the available FAB source, while the active destination descriptor decides whether that FAB is passed through the public `fab` slot.

### Level 2

The Back action moves out from beneath the central identity action and becomes interactive.

The central identity displays the contextual entity. A selected client uses the client's display name and avatar URL. Other level-2 surfaces may use a registered UI icon and title.

Browser Back, Telegram BackButton and the in-app Back `IdentityAction` must resolve through the same `NavigationContext.onBack` path.

### Navbar entrance motion

On initial mount, side action regions originate beneath the central identity region and move to their resolved positions. On level changes the left Back region moves between its hidden level-1 position and visible level-2 position.

`prefers-reduced-motion` reduces this motion to effectively immediate state changes.

## IdentityAction

`IdentityAction` is the only action primitive used inside `MezfitNavbar`.

Supported variants:

- `labeled` — icon or avatar plus title;
- `single` — one icon/avatar action;
- `double` — one GlassSurface capsule containing two independent semantic button zones.

The double variant animates the whole capsule while the tapped inner button determines which action is invoked. Its two action zones share one uninterrupted GlassSurface without a visible vertical divider. In `MezfitNavbar`, Calendar is the left action and uses the registered outline calendar asset at an actual 32px icon box; contextual Menu is the right action and uses the registered settings asset in the same 32px icon box. Button actions run after the shared press animation completes.

Labeled identity icons use registered outline assets in an actual 32px icon box. The size is applied through the primitive's icon API rather than relying on CSS that can be overridden by the icon renderer's inline geometry. The labeled identity keeps one stable action host while its visual slot changes between registered icon and avatar content. Navigation must update props rather than keying/remounting the component.

## Page menu

The right menu action is the entry point for contextual page/entity actions. `NavigationContext.menuActions` may contribute actions for level-2 surfaces.

Account/system actions required to preserve application access may be appended as secondary menu content, but primary destination navigation does not live in this menu.

## Calendar

The first (left) action in the right double capsule opens the application calendar/date selection surface.

Calendar data ownership is outside `MezfitNavbar`; the navbar only emits the calendar intent.

## First-level Tabs

Primary role destinations are rendered with the approved UI Kit `LiquidGlassIconOnly` tab bar. The production contract always contains exactly five positions and preserves the UI Kit icon mapping. Coach mode: Сегодня (`calendar-event`), Клиенты (`users`), Программы (`clipboard-list`), Аналитика (`chart-dots-2`), Настройки (`settings`). Client mode: Сегодня (`calendar-event`), Тренировка (`barbell`), Программы (`clipboard-list`), Аналитика (`chart-dots-2`), Настройки (`settings`). Missing product screens render level-1 placeholders rather than changing the tab composition.

The tab bar reports the selected destination to `NavigationShell`; it does not duplicate destination title/icon state. The existing workout FAB remains owned above the primitive and page-specific creation actions register through the navigation FAB contract. The active destination descriptor decides whether the resolved FAB is passed through the public `fab` slot: Сегодня, Клиенты/Тренировка and Программы allow a FAB; Аналитика and Настройки do not. On `hidden: true → false`, `LiquidGlassIconOnly` selects its approved entrance choreography from current FAB presence: with FAB uses the FAB reveal, without FAB uses the center-spread no-FAB reveal. FAB availability may change while level 1 remains visible without replaying entrance.

The shell derives first-level navbar identity from the destination descriptor. `About` remains a secondary page/system-menu destination; `Settings` is a primary fifth tab.

## Role switching and client coach selection

Role switching remains application navigation state and clears nested context before switching role.

For client mode, coach selection remains available from the page/system menu. These system actions do not replace the page-specific contextual action contract.

## Telegram and browser navigation

When level 2 is active:

- Telegram BackButton is shown and subscribed to the same Back request;
- an application history entry is maintained for browser/webview Back;
- the visible in-app Back action uses that same request path.

At level 1 the Telegram BackButton remains hidden.

## Typography

Navbar interactive text uses the shared Body 15/20 medium role through `IdentityAction`. Do not introduce component-specific typography values.

## Explicit non-patterns

Mezfit navigation must not:

- create a second navigation state inside `MezfitNavbar`;
- derive level from DOM presence, CSS classes or button visibility;
- put two independent commands inside one semantic `button`;
- create a separate split-action primitive for navbar use;
- use Konsta Navbar `left`/`right` Glass slots around `IdentityAction`, which would create nested glass surfaces;
- remount the central identity action merely because its icon/avatar/title changed;
- use the page menu as the primary first-level destination navigator;
- replace the approved Liquid Glass tab bars with generic Radix Tabs for product navigation;
- ignore Telegram BackButton/history coordination.
