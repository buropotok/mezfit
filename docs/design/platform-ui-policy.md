# Mezfit platform UI policy

Status: **canonical for MVP UI implementation**.

This document defines how Mezfit chooses between Telegram platform conventions, the Gym Keeper reference APK and Mezfit-specific design decisions. It complements `docs/design/ui-spec-v1.md` and `docs/design/navigation-shell.md`.

## 1. Reference hierarchy

When implementing UI, use the following precedence unless a linked Issue explicitly documents a reason to diverge.

### 1. Telegram platform layer

Use Telegram Mini App platform capabilities and interaction conventions whenever they solve a generic platform problem without changing Mezfit product behavior.

This includes, where applicable:

- Telegram theme parameters and theme-change events;
- viewport and expansion state;
- `safeAreaInset` / `contentSafeAreaInset` and their change events;
- native Mini App Back Button, bottom/main/secondary buttons, settings button and popup mechanisms where they fit the required flow;
- common Telegram-like patterns for generic list, section, cell, settings, confirmation and account surfaces;
- Telegram identity data such as user name and available profile photo.

Telegram is the **platform reference**, not the product-domain specification.

### 2. Gym Keeper reference APK

For fitness/product flows that already exist in Gym Keeper, the APK remains the default UX/product reference.

Preserve unless there is an explicit product reason to diverge:

- information hierarchy;
- field presence and order;
- selector vs free-text decisions;
- badges/chips vs text inputs;
- modal/inline interaction model;
- action hierarchy;
- navigation semantics;
- task density;
- approved UI icon assets;
- approved exercise GIF/image assets.

Telegram conventions may supply the platform shell or generic control treatment, but must not silently change the Gym Keeper product flow.

### 3. Mezfit design system

Mezfit owns the visual and product-specific layer:

- Variant 4 spacing, density and geometry from `ui-spec-v1.md`;
- the five global customer themes;
- coach/client collaboration flows that do not exist in Gym Keeper;
- selected-client cockpit and other Mezfit-only screens;
- backend-driven state and authorization behavior.

## 2. Conflict rule

If references overlap, apply this order:

1. preserve the required Mezfit product behavior and domain invariants;
2. preserve Gym Keeper flow semantics when the flow has a reference analogue;
3. use Telegram-native/platform behavior for generic shell and controls when compatible;
4. apply Variant 4 visual tokens and current global theme.

Example: an exercise category remains a selector because Gym Keeper defines it as a controlled selection. The selector may use a Telegram-like list/cell presentation and Telegram safe-area behavior, while its spacing/radius follows Variant 4.

## 3. Do not reinvent generic platform UI

Before creating a new custom primitive for a generic interaction, check whether Telegram already provides the capability or a well-established Mini App convention.

Examples where a custom invention requires justification:

- Back navigation;
- app-level primary/secondary bottom actions;
- settings/account rows;
- standard list cells and sections;
- generic confirmations/popups;
- safe-area and viewport handling;
- profile identity presentation.

A custom implementation is valid when Telegram's native mechanism cannot satisfy the required Gym Keeper/Mezfit product flow, accessibility requirement, global theme requirement or cross-platform consistency requirement.

## 4. Telegram theme parameters vs Mezfit global themes

Mezfit's customer-selected theme remains global and authoritative for product colors.

Telegram theme parameters are still useful for platform integration, including host/header/background coordination, system contrast decisions and transitional surfaces. They must not create an independent per-user Mezfit theme that overrides the selected global theme.

The frontend should keep Telegram theme values and Mezfit product-theme tokens conceptually separate.

## 5. Safe area and viewport are mandatory platform inputs

UI must not assume that fixed CSS page padding is sufficient inside Telegram.

Where a screen touches the top, bottom or fullscreen edges, layout must account for Telegram-provided safe-area/content-safe-area values and react to changes. The same applies to viewport changes caused by Mini App expansion, fullscreen mode, keyboard or Telegram controls.

Canonical rule:

```text
visual component size
+ Variant 4 spacing
+ Telegram safe-area/content-safe-area inset where applicable
= final screen geometry
```

Do not hard-code device-specific notch/home-indicator padding.

## 6. Native controls

Prefer Telegram-native controls when all of the following are true:

- the control represents an app/platform action rather than domain data entry;
- using it does not change the established Gym Keeper/Mezfit flow;
- it is supported in the target Telegram Mini App environment;
- its behavior is deterministic enough for the current feature.

Examples:

- native Back Button for navigation when appropriate;
- native bottom/main/secondary action for a single dominant screen action when it does not conflict with the reference flow;
- native popup/confirmation for generic confirmations where custom content is not required.

Do not force native controls into a flow merely to appear Telegram-like.

## 7. Component libraries

A Telegram-oriented React UI library may be used selectively as an implementation aid, but **no external Telegram UI kit is a mandatory architectural dependency**.

Before adding such a dependency, verify:

- compatibility with the project's React version;
- maintenance status;
- accessibility and keyboard behavior;
- bundle impact;
- ability to honor Variant 4 geometry and all five global themes.

Prefer small Mezfit primitives that reproduce the required platform behavior over adopting a large UI dependency only for visual similarity.

## 8. Implementation review checklist

A UI PR is not ready to merge if a relevant answer is “no” without an explicit rationale:

- Does this screen run inside Telegram with correct safe-area/content-safe-area handling?
- If viewport height can change, does the layout tolerate Telegram viewport changes?
- Is there a Telegram-native control or established platform pattern that should be reused instead of a custom primitive?
- If Gym Keeper has this product flow, was its corresponding screen/flow inspected first?
- Are Gym Keeper field/control/action semantics preserved?
- Are Mezfit-only changes clearly separated from reference behavior?
- Does the UI still follow Variant 4 density/geometry and the active global theme?
- Does the PR link and close a concrete Issue?

## 9. Official Telegram references

Implementation should validate current Telegram behavior against official documentation rather than relying on remembered API details:

- https://core.telegram.org/bots/webapps
- https://core.telegram.org/api/bots/webapps
- https://core.telegram.org/api/web-events

These documents are the source of truth for supported Mini App platform events, theme parameters, viewport/safe-area behavior and native control capabilities.