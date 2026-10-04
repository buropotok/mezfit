# Mezfit Typography System

This document is the authoritative typography contract for the Mezfit UI. It applies to Client, Coach, shared UI, UI Kit, modals, menus, forms, lists, navigation, and every new screen or component.

## Font family

Use the shared typography font stack only:

```css
font-family: var(--ui-font-family);
```

`--ui-font-family` resolves to Zen Maru Gothic for the whole product. The font is loaded centrally by `src/ui/tokens/typography.css`. Do not introduce component-local font-family stacks.

## Type scale

| Role | Token | Size / line-height | Default weight | Letter spacing | Intended use |
| --- | --- | --- | --- | --- | --- |
| Large title | `--ui-font-size-large-title` / `--ui-line-height-large-title` | 24 / 24 px | 500 | 0 px | Primary screen title |
| Title | `--ui-font-size-title` / `--ui-line-height-title` | 20 / 24 px | 500 | 0.35 px | Large content or section heading |
| Headline | `--ui-font-size-headline` / `--ui-line-height-headline` | 17 / 22 px | 400 | 0.5 px | Important heading, including every modal title |
| Body | `--ui-font-size-body` / `--ui-line-height-body` | 15 / 20 px | 300 | 0.35 px | Normal UI text, inputs, selects, textareas |
| Footnote | `--ui-font-size-footnote` / `--ui-line-height-footnote` | 13 / 18 px | 300 | 0.55 px | Secondary text, metadata, field labels |
| Caption | `--ui-font-size-caption` / `--ui-line-height-caption` | 12 / 16 px | 300 | 0.4 px | Small service/supporting information |

Available weight tokens:

```css
--ui-font-weight-light: 300;
--ui-font-weight-regular: 400;
--ui-font-weight-medium: 500;
--ui-font-weight-semibold: 600;
--ui-font-weight-bold: 700;
```

Use weight semantically. Do not create a new font size, line-height, weight, or font family when an existing role satisfies the requirement.

## Semantic preset rule

The six roles above — **Large title, Title, Headline, Body, Footnote, Caption** — are atomic typography presets and the only app-owned typography presets in Mezfit.

Every app-owned text element must select exactly one of these presets through the shared semantic typography API, normally the `Text` primitive and its `variant`. A component must not reconstruct a preset from individual `font-family`, `font-size`, `line-height`, `font-weight`, or `letter-spacing` tokens, and must not override one of those properties to create a component-local variant while still treating the text as the same semantic role.

If none of the six presets fits a product requirement, stop and request a deliberate typography-system change. Do not solve the mismatch with component-local font rules or weight overrides.

Component CSS may own layout around text and non-typographic presentation, but the typography bundle itself remains owned by the selected semantic preset.

## Component mapping rules

All text-bearing UI must map to the shared type scale. The standard mapping is:

| UI element | Typography |
| --- | --- |
| Main screen title | Large title |
| Large content / section heading | Title |
| Modal title | Headline |
| Important compact heading / app-bar heading | Headline |
| Main text | Body |
| Input / textarea / select / search text | Body |
| Button / interactive text | Body |
| List item primary text | Body |
| Field label / important secondary label | Footnote |
| Secondary text / metadata | Footnote |
| Small service/supporting text | Caption |

### Modal rule

A modal title is always **Headline — 17/22, regular 400**, not Title 20/24.

Inside a normal modal, use this hierarchy:

| Modal element | Typography |
| --- | --- |
| Title | Headline |
| Main content | Body |
| Field/control text | Body |
| Buttons | Body |
| Field labels / important labels | Footnote |
| Secondary explanations | Footnote |
| Small service text | Caption |

Normal textual content must not use sizes below Caption 12/16. Smaller dimensions may still be used for non-text visual geometry such as icons when typography is not involved.

## Mandatory implementation rule

Every newly created app-owned text-bearing element in the application must use one of the six semantic presets as a complete bundle. Prefer the shared `Text` primitive or another shared component API that delegates to those presets. Component-owned CSS must not recreate or partially override a semantic preset with typography declarations.

Konsta UI primitives are the exception at the primitive boundary: their internal typography is part of the library-owned visual representation and must not be overridden to force Mezfit typography tokens onto the primitive. The product-level font choice is configured through Konsta's supported Tailwind theme API: the iOS token `--font-ios` points to `var(--ui-font-family)` in `src/ui/konsta.css`, using the shared Zen Maru Gothic family. Do not target Konsta internal `.k-*` selectors or otherwise restyle a Konsta primitive's text. Mezfit typography tokens still apply to app-owned text and composition outside the primitive itself.

Do not create parallel component-specific typography systems. A component may choose an existing semantic role, but it must not invent its own type scale.

## Mandatory cleanup rule for development agents/workers

Before modifying a screen or UI component, the development agent/worker must inspect the typography of the affected surface.

If the affected screen or component contains its own legacy/custom typography that does not follow this document, the agent/worker must automatically migrate that affected typography to the closest semantic role from the mapping table as part of the same change. This cleanup does not require a separate reminder.

The migration must preserve the intended information hierarchy. Do not mechanically replace a value only because it is numerically close: classify the text by its UI role first, then apply the corresponding semantic preset as a whole.

If the correct semantic role is genuinely ambiguous or changing it would materially alter an intentional product hierarchy, stop and ask for a product/design decision rather than inventing a new typography value.

## Source of truth

The CSS token definitions live in `src/ui/tokens/typography.css`. The semantic `Text` role styles live in `src/ui/typography.css`. This document defines how those tokens and roles must be used across the application.
