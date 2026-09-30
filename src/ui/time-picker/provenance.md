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
- the zoom field is an inward sampling field for deterministic magnification.

The rendered TimePicker filter uses only those two displacement stages. Its
former SVG specular blend is intentionally not composited: the visible bezel
and highlights come from the approved `LiquidGlassTextOnly` shell instead.

Unlike the article's Chrome-only demo, the lens filter is applied directly to a
synchronized inline SVG text layer. The primitive does not depend on
`backdrop-filter: url(...)` for magnification, which avoids making the lens
mechanics contingent on Chromium-only backdrop SVG reference filters.

The visible lens shell follows the approved `LiquidGlassTextOnly` lens treatment:
17% dark tint, zero blur, 1.05 saturation, 1.02 brightness, the same four inset
bezel highlights, and the same 0 8px 24px / 20% outer shadow. TimePicker does
not reuse the Text Only interaction runtime; it only reuses the approved shell
appearance around its own hour/minute displacement layer.

The surrounding overlay uses the existing Mezfit/Konsta Popover primitive. The
shared wrapper exposes a public `iosHighlight` opt-out so TimePicker can disable
Konsta's radial press glow without targeting private Konsta DOM or CSS.
