# Mezfit UI Kit

Konsta UI v5 is the canonical UI kit for Mezfit product UI.

## Pinned integration

- React package: `konsta/react`
- Konsta version: `5.4.0`
- Tailwind CSS version: `4.3.3`
- Tailwind Vite plugin: `@tailwindcss/vite` `4.3.3`
- Konsta/Tailwind stylesheet entry: `src/ui/konsta.css`
- Global provider: `KonstaProvider` in `src/main.tsx`
- Canonical Konsta theme: iOS + dark

## Usage contract

Use Konsta primitives directly from `konsta/react` whenever the library provides the required UI primitive. Configure them only through their documented public props, slots, variants, and provider settings.

Do not change a Konsta primitive's mechanics or visual representation with project CSS, wrapper-only styling, copied markup, forks, or selectors that target Konsta internals such as `.k-*` classes.

If the public Konsta API cannot express a required interaction or appearance, report the missing capability instead of locally modifying the primitive. The UI kit must then be deliberately extended or the product requirement revised.

Mezfit-owned CSS may control composition, page layout, spacing around primitives, and app-owned content. The Mezfit typography system applies to app-owned text; typography inside a Konsta primitive remains library-owned.

The canonical Konsta theme for Mezfit is iOS + dark. It is applied globally through `KonstaProvider theme="ios" dark` and the required public root classes `k-ios dark`. Do not substitute a different Konsta theme on individual product surfaces unless the product decision is explicitly changed.

Existing pre-Konsta components under `src/ui` are migration-era components. They may remain until their owning surfaces are intentionally migrated, but they must not be expanded as a parallel UI kit when Konsta already covers the requirement.
