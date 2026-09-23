# Mezfit Typography System

This document is the authoritative typography contract for the Mezfit UI. It applies to Client, Coach, shared UI, UI Kit, modals, menus, forms, lists, navigation, and every new screen or component.

## Font family

Use the shared typography font stack only:

```css
font-family: var(--ui-font-family);
```

`--ui-font-family` resolves to the native Apple system font (SF Pro) on Apple platforms and falls through to bundled Golos Text on other platforms. Do not introduce component-local font-family stacks.

## Type scale

| Role | Token | Size / line-height | Default weight | Intended use |
| --- | --- | --- | --- | --- |
| Large title | `--ui-font-size-large-title` / `--ui-line-height-large-title` | 24 / 28 px | 400 | Primary screen title |
| Title | `--ui-font-size-title` / `--ui-line-height-title` | 20 / 24 px | 400 | Large content or section heading |
| Headline | `--ui-font-size-headline` / `--ui-line-height-headline` | 17 / 22 px | 500 | Important heading, including every modal title |
| Body | `--ui-font-size-body` / `--ui-line-height-body` | 15 / 20 px | 400 | Normal UI text, inputs, selects, textareas |
| Footnote | `--ui-font-size-footnote` / `--ui-line-height-footnote` | 13 / 18 px | 400 | Secondary text, metadata, field labels |
| Caption | `--ui-font-size-caption` / `--ui-line-height-caption` | 12 / 16 px | 400 | Small service/supporting information |

Available weight tokens:

```css
--ui-font-weight-regular: 400;
--ui-font-weight-medium: 500;
--ui-font-weight-semibold: 600;
--ui-font-weight-bold: 700;
```

Use weight semantically. Do not create a new font size, line-height, weight, or font family when an existing role satisfies the requirement.

## Component mapping rules

All text-bearing UI must map to the shared type scale. The standard mapping is:

| UI element | Typography |
| --- | --- |
| Main screen title | Large title — 24/28, regular 400 |
| Large content / section heading | Title — 20/24, regular 400 |
| Modal title | Headline — 17/22, medium 500 |
| Important compact heading / app-bar heading | Headline — 17/22, medium 500 |
| Main text | Body — 15/20, regular 400 |
| Input / textarea / select / search text | Body — 15/20, regular 400 |
| Button / interactive text | Body — 15/20, medium 500 |
| List item primary text | Body — 15/20, semibold 600 when emphasis is required |
| Field label / important secondary label | Footnote — 13/18, semibold 600 |
| Secondary text / metadata | Footnote — 13/18, regular 400 |
| Small service/supporting text | Caption — 12/16, regular or medium 400–500 |

### Modal rule

A modal title is always **Headline — 17/22, medium 500**, not Title 20/24.

Inside a normal modal, use this hierarchy:

| Modal element | Typography |
| --- | --- |
| Title | Headline — 17/22, 500 |
| Main content | Body — 15/20, 400 |
| Field/control text | Body — 15/20, 400 |
| Buttons | Body — 15/20, 500 |
| Field labels / important labels | Footnote — 13/18, 600 |
| Secondary explanations | Footnote — 13/18, 400 |
| Small service text | Caption — 12/16, 400–500 |

Normal textual content must not use sizes below Caption 12/16. Smaller dimensions may still be used for non-text visual geometry such as icons when typography is not involved.

## Mandatory implementation rule

Every newly created app-owned text-bearing element in the application must use this typography system. Prefer existing shared primitives and semantic typography roles. When component-owned CSS is appropriate, reference the shared typography tokens directly instead of duplicating literal font sizes or line-heights.

Konsta UI primitives are the exception at the primitive boundary: their internal typography is part of the library-owned visual representation and must not be overridden to force Mezfit typography tokens onto the primitive. Do not target Konsta internal `.k-*` selectors or otherwise restyle a Konsta primitive's text. Mezfit typography tokens still apply to app-owned text and composition outside the primitive itself.

Do not create parallel component-specific typography systems. A component may choose an existing semantic role, but it must not invent its own type scale.

## Mandatory cleanup rule for development agents/workers

Before modifying a screen or UI component, the development agent/worker must inspect the typography of the affected surface.

If the affected screen or component contains its own legacy/custom typography that does not follow this document, the agent/worker must automatically migrate that affected typography to the closest semantic role from the mapping table as part of the same change. This cleanup does not require a separate reminder.

The migration must preserve the intended information hierarchy. Do not mechanically replace a value only because it is numerically close: classify the text by its UI role first, then apply the corresponding token pair and weight.

If the correct semantic role is genuinely ambiguous or changing it would materially alter an intentional product hierarchy, stop and ask for a product/design decision rather than inventing a new typography value.

## Source of truth

The CSS token definitions live in `src/ui/tokens/typography.css`. The semantic `Text` role styles live in `src/ui/typography.css`. This document defines how those tokens and roles must be used across the application.
