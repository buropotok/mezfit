# Mezfit navigation shell

Status: canonical UI contract for global navigation.

## Reference-first rule

Gym Keeper's left navigation drawer is the reference pattern for Mezfit global navigation. Visual tokens may differ, but the global UX pattern is preserved: compact top app bar, hamburger on top-level destinations, left overlay drawer, and contextual Back navigation inside a selected entity.

## App bar

| Token | Value |
| --- | ---: |
| height | 52 px |
| left action target | 44 × 44 px |
| right action reserve | 44 × 44 px |
| title | 16/20 px, semibold |
| horizontal page inset | 16 px |
| title overflow | one line, ellipsis |
| bottom divider | 1 px |

Top-level destination: left action is hamburger.

Selected-client context: left action is Back and title is the selected client's display name. The drawer is not duplicated inside the selected-client context; returning to the global level restores hamburger navigation.

## Drawer

| Token | Value |
| --- | ---: |
| width | 280 px |
| max width | 84vw |
| position | fixed, left edge |
| height | 100dvh |
| outer radius | 0 px |
| backdrop | rgba(0,0,0,0.56) |
| navigation row | 48 px |
| row horizontal padding | 16 px |
| icon slot | 24 px |
| icon-to-label gap | 12 px |
| section divider | 1 px |
| account block min height | 76 px |
| account avatar | 40 × 40 px |

Required close paths: destination selection, backdrop tap, Escape. Keyboard focus stays inside the open drawer and returns to the hamburger after closing.

## Global destinations

### Coach

1. Клиенты
2. Программы
3. Упражнения
4. Календарь
5. divider
6. Настройки
7. О приложении

### Client

1. Сегодня
2. Программа
3. Упражнения
4. История
5. Прогресс
6. divider
7. Настройки
8. О приложении

Unimplemented destinations remain visible and render a compact stable placeholder. We do not hide navigation merely because a destination is scheduled for a later issue.

## Selected-client contextual navigation

The selected client's local sections are not global drawer destinations:

- Обзор
- Программа
- Упражнения
- Календарь
- Прогресс
- История

They remain a compact horizontally scrollable local navigation control below the contextual app bar.

## Role switching

When the Telegram user has both roles, role switching lives in the drawer account area. It does not occupy permanent app-bar space. Switching roles closes the drawer, clears selected-client context, and restores the last top-level destination for the target role.

## Explicit non-patterns

Mezfit does not use these as its global mobile navigation pattern:

- bottom tab navigation;
- permanently visible desktop sidebar;
- oversized branding header above every screen;
- duplicating selected-client local sections inside the global drawer.

## Themes

The drawer consumes the existing global theme tokens:

- app bar: `theme-bg`, `theme-bg-text`, `theme-bg-muted`;
- drawer/surfaces: `theme-surface`, `theme-surface-2`, `theme-surface-text`, `theme-surface-muted`, `theme-border`;
- selected item: global accent.

The same shell geometry is invariant across all five themes.
