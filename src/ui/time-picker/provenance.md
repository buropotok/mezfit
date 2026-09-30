# TimePicker lens provenance

The TimePicker lens is an app-owned UI Kit primitive inspired by Kube's article
"Liquid Glass in the Browser: Refraction with CSS and SVG":

https://kube.io/blog/liquid-glass-css-svg/

The article documents the optical model used here: a convex-squircle bezel,
Snell-law refraction, normalized RG displacement fields with 128 as the neutral
channel value, a separate specular image, and a magnifying-glass composition
that uses two displacement maps (edge refraction plus a stronger zoom map).

The article does not publish the original magnifying-glass bitmap or its exact
zoom-map generator. Mezfit therefore generates its own maps at runtime:
- the edge field follows the documented convex-squircle/Snell construction;
- the zoom field is an inward sampling field for deterministic magnification;
- the specular field is generated separately and blended over the refracted text.

Unlike the article's Chrome-only demo, the lens filter is applied directly to a
synchronized inline SVG text layer. The primitive does not depend on
`backdrop-filter: url(...)` for magnification, which avoids making the lens
mechanics contingent on Chromium-only backdrop SVG reference filters.

The surrounding overlay uses the existing Mezfit/Konsta Popover primitive; no
Konsta private DOM or visual mechanics are modified.
