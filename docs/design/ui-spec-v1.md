# Mezfit UI Specification v1 — Variant 4

Status: **canonical for MVP UI implementation**.

This document freezes the visual system selected as **Variant 4**, the `reference-first` UX rule for flows that already exist in Gym Keeper, and the Telegram platform reuse policy defined in `docs/design/platform-ui-policy.md`.

## 0. Platform UI reference hierarchy

The UI must not be designed as an isolated website inside a Telegram webview. Use the following reference hierarchy:

1. **Telegram platform layer** — theme parameters, viewport/safe-area inputs, native Mini App controls and generic Telegram interaction conventions where they fit the task.
2. **Gym Keeper reference APK** — product flow, information hierarchy, field/control choice, navigation semantics and approved reference assets for existing fitness flows.
3. **Mezfit design system** — Variant 4 geometry/density, the five global customer themes and Mezfit-specific product flows.

When these overlap, preserve Mezfit domain invariants first, then Gym Keeper product-flow semantics, then reuse Telegram platform behavior where compatible, then apply Variant 4 visual tokens.

Generic platform UI should not be reinvented without reason. Before creating custom Back navigation, settings/account rows, generic list/section/cell patterns, standard confirmations or platform-edge spacing, check Telegram Mini App capabilities and conventions first.

Telegram-oriented React UI libraries may be used selectively, but no external UI kit is a mandatory dependency. Any dependency must be compatible with the project's React version, accessibility requirements, bundle constraints, Variant 4 geometry and all five global themes.

Telegram theme values and the Mezfit global product theme are separate concepts: Telegram parameters may coordinate host/header/background integration, but they must not create an independent per-user override of the globally selected Mezfit theme.

## 1. Reference-first UX rule

For a flow that exists in the Gym Keeper reference APK, the reference defines the default UX contract.

The implementation **must preserve unless a linked Issue explicitly documents a reason to diverge**:

- information hierarchy;
- field/control presence;
- field order;
- interaction type (selector vs free text, badges vs text input, modal vs inline, etc.);
- primary and secondary actions;
- navigation sequence;
- density of the task-oriented screen.

Mezfit may change decorative styling: palette, typography family, borders, small corner radii and other non-behavioral treatment. Where a corresponding approved Gym Keeper UI icon asset exists, use that reference asset rather than inventing an unrelated icon metaphor; this is tracked by the relevant UI/icon issue.

New Mezfit-only concepts may introduce new controls, but they should be appended or integrated without redesigning the reference flow around backend/domain fields.

### Required review rule

Before implementing a screen with a Gym Keeper analogue, the implementer must inspect the corresponding APK screen/flow. The Issue/PR should state the reference screen and any intentional deviations.

Before implementing generic platform interaction, the implementer should also verify current Telegram Mini App capabilities instead of relying on remembered API details.

## 2. Base geometry

All spacing uses a **4 px base grid**.

Allowed spacing tokens:

| Token | Value |
|---|---:|
| `space-1` | 4 px |
| `space-2` | 8 px |
| `space-3` | 12 px |
| `space-4` | 16 px |
| `space-5` | 20 px |
| `space-6` | 24 px |
| `space-8` | 32 px |

Do not introduce arbitrary 14/18/22/28 px layout gaps.

### Page layout

- horizontal page padding: **16 px**;
- top content padding below app bar: **12 px**;
- bottom content padding before safe area/bottom navigation: **16 px**;
- gap between major sections: **16 px**;
- gap between related rows/controls: **8 px**;
- gap between independent form fields: **12 px**;
- maximum readable content width on large screens: **720 px**;
- form/modal content width: **420 px max** where a centered narrow layout is appropriate.

### Telegram safe area and viewport

Variant 4 spacing is component/layout spacing, not a substitute for Telegram platform insets.

Where content touches a protected top/bottom/side edge, final geometry is:

```text
Variant 4 component geometry
+ Telegram safeAreaInset/contentSafeAreaInset where applicable
= final screen geometry
```

The UI must tolerate Telegram viewport changes caused by expansion, fullscreen mode, keyboard or Telegram controls. Do not hard-code notch/home-indicator padding for individual devices.

## 3. Corner radii

Variant 4 does not use oversized rounded web cards.

| Element | Radius |
|---|---:|
| standard card / list group | **8 px** |
| input / select / textarea | **6 px** |
| primary/secondary button | **6 px** |
| modal dialog | **10 px** |
| bottom sheet top corners | **10 px** |
| chip / equipment badge | **8 px** |
| thumbnail/image tile | **8 px** |
| tiny status marker | **4 px** |

`border-radius: 999px` is prohibited for normal cards/buttons/inputs. It may only be used for a genuinely circular control/avatar or a design element whose semantic shape is a pill.

## 4. Typography

Default font stack:

```css
font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
```

Allowed weights for ordinary UI: **400 / 500 / 600**.

| Role | Size / line-height | Weight |
|---|---|---:|
| screen title | **24 / 28 px** | 600 |
| modal title | **20 / 24 px** | 600 |
| section title | **16 / 20 px** | 600 |
| body | **15 / 20 px** | 400 |
| control text | **15 / 20 px** | 500 |
| field label | **13 / 16 px** | 600 |
| secondary/caption | **12 / 16 px** | 400 |
| bottom-nav label | **11 / 14 px** | 500 |

Rules:

- no 28–36 px headings inside normal task screens;
- no all-bold cards;
- numbers that require emphasis may use weight 600, not larger cards/padding.

## 5. Interactive control sizes

### Touch target

Minimum touch target: **44 × 44 px**.

A visible icon may be smaller, but the clickable/tappable wrapper must be at least 44 × 44 px.

### Controls

| Control | Height / size |
|---|---:|
| text input | **44 px** |
| select | **44 px** |
| primary button | **44 px** |
| compact secondary button | **40 px** visual, **44 px** touch target |
| textarea | **72 px minimum** |
| list row | **48 px minimum** |
| app bar | **52 px** + applicable Telegram safe area |
| bottom navigation | **56 px** + applicable Telegram safe area |
| icon in standard control | **20 px** |
| toolbar/navigation icon | **22 px** |
| radio/checkbox visual | **20 px** |

Field horizontal padding: **12 px**.

Button horizontal padding: **16 px**.

### Native Telegram controls

Prefer Telegram-native controls when the action is app/platform-level, the native behavior is supported in the target Mini App environment, and using it does not change the established Gym Keeper/Mezfit product flow. Examples include Back navigation, a single dominant bottom action and generic platform confirmations.

Do not force native controls into domain-heavy flows merely for visual similarity.

## 6. Cards and list density

Standard card:

```text
padding: 12 px
radius: 8 px
border: 1 px
internal row gap: 8 px
external gap to next card: 8 px
```

Rules:

- avoid wrapping each individual label/value pair in its own card;
- prefer one list/group surface with 48 px rows and 1 px separators;
- for generic list/settings/account screens, prefer established Telegram-like cell/section behavior rather than inventing a decorative card system;
- nested cards are prohibited unless the reference flow requires nested visual grouping;
- a screen should not gain vertical space merely to make a card feel “premium”.

## 7. Chips / badges

Equipment/category/status chips use the following geometry:

- height: **28 px**;
- minimum width: **44 px** when interactive;
- horizontal padding: **10 px**;
- icon-to-text gap: **6 px**;
- inter-chip gap: **6 px**;
- row gap when wrapped: **6 px**;
- radius: **8 px**;
- text: **12/16 px, weight 500**;
- border: **1 px**.

Selected chip uses filled semantic/accent background; unselected chip uses surface background + border.

## 8. Modal and bottom-sheet geometry

### Dialog modal

- width: `min(calc(100vw - 32px), 420px)`;
- max height: `calc(100dvh - 32px)` adjusted for applicable Telegram content safe area;
- outer radius: **10 px**;
- internal padding: **16 px**;
- title bottom gap: **16 px**;
- content field gap: **12 px**;
- actions top gap: **16 px**;
- action gap: **8 px**;
- backdrop: `rgba(0, 0, 0, 0.68)`;
- modal shadow only: `0 8px 24px rgba(0,0,0,.35)`.

For generic confirmations with no custom content requirement, a Telegram-native popup/confirmation may be preferred. For Gym Keeper-equivalent task modals or Mezfit domain forms, preserve the approved product flow.

### Bottom sheet

- max height: **92dvh** minus applicable Telegram safe-area constraints;
- top radius: **10 px**;
- horizontal padding: **16 px**;
- top/bottom internal padding: **12 / 16 px**;
- scrollable content must remain inside the sheet; actions may be sticky if the reference task benefits from it.

## 9. Variant 4 default palette

Canonical default theme tokens:

```css
--color-bg: #0B1118;
--color-surface: #111A24;
--color-surface-2: #162230;
--color-input: #192635;
--color-border: #2A3948;

--color-text: #F5F7FA;
--color-text-secondary: #9BAABA;
--color-text-disabled: #647382;

--color-accent: #2F9BFF;
--color-positive: #36C96B;
--color-warning: #FFB84D;
--color-danger: #FF5263;
--color-focus: #44ADFF;
```

Semantics:

- blue (`accent`) — selected/focus/navigation/neutral primary interaction;
- green (`positive`) — Add/Save/Confirm when the action is affirmative;
- red (`danger`) — delete/destructive/error;
- yellow (`warning`) — warning/attention, not generic decoration.

### Borders

- ordinary border: `1px solid var(--color-border)`;
- separators: `1px` with `color-mix`/alpha equivalent to approximately **55%** of border contrast;
- no default card shadow.

## 10. Category accent colors

Category color is an aid to scanning, not the full background of large cards.

| Category | Accent |
|---|---|
| Chest / Грудь | `#FF4D6D` |
| Arms / Руки | `#FF8A3D` |
| Back / Спина | `#2F9BFF` |
| Legs / Ноги | `#36C96B` |
| Shoulders / Плечи | `#FFCA3A` |
| Core / Корпус | `#9B5DE5` |
| Full body / Фулбоди | `#F15BB5` |
| Cardio / Кардио | `#FF5263` |
| Other / Другое | `#7C8A99` |

Use these for 18 px category icons, a **3 px** leading indicator, selected radio/accent, or compact badges.

## 11. Global theme contract

Theme is **global for the whole Mezfit deployment**, not a per-user preference.

Every theme is defined by two primary requested colors:

- `appBackground` — whole-app background;
- `surfaceBackground` — cards, modals, form surfaces, list groups.

Other tokens are explicit derived/fixed theme values so contrast is deterministic.

Initial global presets:

| Theme | `appBackground` | `surfaceBackground` | surface text |
|---|---|---|---|
| `default` | `#0B1118` | `#111A24` | `#F5F7FA` |
| `graphite-cobalt` | `#202327` | `#123B7A` | `#F7FAFF` |
| `emerald-sand` | `#073B2C` | `#D8C3A5` | `#171A17` |
| `burgundy-milk` | `#5A0B18` | `#EFE3CF` | `#23181A` |
| `black-terracotta` | `#08090A` | `#B84F2A` | `#FFF8F3` |

Accent/category semantic colors remain stable unless contrast forces a theme-specific override.

Theme selection is stored as a backend/global application setting. Frontend must not maintain a separate per-user theme source of truth.

Telegram theme parameters may coordinate the surrounding Telegram host/header/background but do not replace this global product-theme contract.

## 12. Canonical `Новое упражнение` contract

For the Gym Keeper-equivalent creation flow, Mezfit must use the same conceptual structure. This is the first test case for `reference-first`.

### Modal geometry

- width: `min(calc(100vw - 32px), 420px)`;
- padding: **16 px**;
- radius: **10 px**.

### Header

- title `Новое упражнение`: **20/24 px, 600**;
- optional close icon: **22 px** inside **44 × 44 px** target.

### First row

- media thumbnail/action: **72 × 72 px**, radius **8 px**;
- gap between media and text column: **12 px**;
- right column contains:
  - `Название` input: **44 px**;
  - gap: **8 px**;
  - `Описание` textarea/input area: **44 px minimum**, expanding to **72 px** when multiline.

`Описание` is retained because it exists in the reference flow. Removing it is not an MVP simplification.

### Result tracking

- selector height: **44 px**;
- full modal content width;
- label above: **13/16 px, 600**.

### Category

- category is a **selector, not free text**;
- height: **44 px**;
- category modal rows: **48 px**;
- category icon: **18 px**;
- radio: **20 px**;
- row horizontal padding: **12 px**.

Canonical first taxonomy:

1. Грудь
2. Руки
3. Спина
4. Ноги
5. Плечи
6. Корпус
7. Фулбоди
8. Кардио
9. Другое

### Equipment

Equipment is **badge/chip selection, not a text field**.

Initial reference choices:

- Свой вес
- Штанга
- Гантель x1
- Гантели x2
- Трос
- Тренажер
- Другое

Use the chip geometry from section 7.

### Mezfit-only availability

`Доступность` is a Mezfit extension and is placed **after the reference equipment block** rather than replacing/reordering reference controls.

- selector height: **44 px**;
- values at minimum:
  - Только этому клиенту
  - Всем моим клиентам

### Actions

Right-aligned actions, with **8 px** gap:

- `Отмена`: text/secondary action with 44 px touch target;
- `Добавить`: positive button, **44 px** height, **6 px** radius, green `--color-positive`.

## 13. Navigation and new Mezfit screens

Gym Keeper reference rules do not prohibit new Mezfit navigation. New coach/client workspace screens may choose their own hierarchy, but must use these same density tokens and the platform rules from `platform-ui-policy.md`.

Canonical global navigation is defined in `docs/design/navigation-shell.md`.

### App bar

- height: **52 px** + applicable Telegram safe-area inset;
- left/right horizontal padding: **12 px**;
- title: **20/24 px, 600** when inside app bar unless the dedicated navigation-shell spec defines a more specific title token;
- icon buttons: **44 × 44 px** targets, **22 px** icons.

### Bottom navigation (when used)

- height: **56 px** + applicable Telegram safe-area inset;
- icon: **22 px**;
- label: **11/14 px, 500**;
- no individual nav-item card backgrounds;
- active state uses accent color and optionally a **2 px** top/underline indicator, not a large pill.

Bottom navigation is not the current global Mezfit navigation pattern; see `navigation-shell.md`.

## 14. CSS token baseline

Implementation should centralize these values instead of repeating magic numbers:

```css
:root {
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 20px;
  --space-6: 24px;
  --space-8: 32px;

  --radius-control: 6px;
  --radius-surface: 8px;
  --radius-modal: 10px;

  --control-h: 44px;
  --list-row-h: 48px;
  --chip-h: 28px;
  --appbar-h: 52px;
  --bottomnav-h: 56px;

  --page-pad-x: 16px;
  --surface-pad: 12px;
  --modal-pad: 16px;

  --color-bg: #0B1118;
  --color-surface: #111A24;
  --color-surface-2: #162230;
  --color-input: #192635;
  --color-border: #2A3948;
  --color-text: #F5F7FA;
  --color-text-secondary: #9BAABA;
  --color-accent: #2F9BFF;
  --color-positive: #36C96B;
  --color-warning: #FFB84D;
  --color-danger: #FF5263;
}
```

Telegram safe-area/content-safe-area values are runtime platform inputs and should not be baked into the static Variant 4 spacing token table.

## 15. PR review checklist

A UI PR is not ready to merge if any answer below is “no” without an explicit rationale:

- Does the screen respect Telegram safe-area/content-safe-area where applicable?
- If Telegram viewport height can change, does the layout tolerate those changes?
- Was a Telegram-native control or established platform pattern considered before inventing a generic custom primitive?
- If Gym Keeper has this flow, was the corresponding reference screen inspected?
- Are the same essential fields/actions/control types preserved?
- Is a selector still a selector rather than a free-text shortcut?
- Are standard page paddings 16 px and card paddings 12 px before applicable platform insets?
- Are normal radii within the specified 6/8/10 px system?
- Are controls 44 px and list rows 48 px unless the reference requires otherwise?
- Are chips 28 px with 6 px gaps?
- Are typography sizes from the frozen scale?
- Is any new Mezfit-only control integrated without rearranging the reference task unnecessarily?
- Does the active global theme remain authoritative instead of being replaced by a per-user Telegram theme?
- Does the PR link and close a concrete Issue?
