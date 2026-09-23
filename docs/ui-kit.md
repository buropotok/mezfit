# Mezfit UI Kit

Konsta UI v5 is the canonical UI kit for Mezfit product UI.

## Pinned integration

- React package: `konsta/react`
- Konsta version: `5.4.0`
- Tailwind CSS version: `4.3.3`
- Tailwind Vite plugin: `@tailwindcss/vite` `4.3.3`
- Konsta/Tailwind stylesheet entry: `src/ui/konsta.css`

## Usage contract

Use Konsta primitives directly from `konsta/react` whenever the library provides the required UI primitive. Configure them only through their documented public props, slots, variants, and provider settings.

Do not change a Konsta primitive's mechanics or visual representation with project CSS, wrapper-only styling, copied markup, forks, or selectors that target Konsta internals such as `.k-*` classes.

If the public Konsta API cannot express a required interaction or appearance, report the missing capability instead of locally modifying the primitive. The UI kit must then be deliberately extended or the product requirement revised.

Mezfit-owned CSS may control composition, page layout, spacing around primitives, and app-owned content. The Mezfit typography system applies to app-owned text; typography inside a Konsta primitive remains library-owned.

This integration does not impose an iOS/Material or light/dark Konsta theme on the existing legacy application root. When a surface is migrated to Konsta, apply the theme only through Konsta's documented `App`/`KonstaProvider` API and required public theme-root class for that owned surface. A product-wide theme choice must be made deliberately rather than introduced as a setup side effect.

Existing pre-Konsta components under `src/ui` are migration-era components. They may remain until their owning surfaces are intentionally migrated, but they must not be expanded as a parallel UI kit when Konsta already covers the requirement.
