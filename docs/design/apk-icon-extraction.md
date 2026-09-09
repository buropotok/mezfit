# APK icon extraction procedure

For Issue #52 the approved reference APK was treated as a ZIP archive and inspected under `res/`. App-specific monochrome navigation assets were identified across Android density buckets. The `drawable-mdpi-v4` variants are already canonical 24×24 PNGs, so those exact bytes are embedded in the frontend rather than resampling a higher-density variant.

White variants are not duplicated in Mezfit: the neutral monochrome PNG alpha channel is used as a CSS mask and tinted with `currentColor`. This keeps one source artwork per semantic action and lets active/inactive states follow the five global themes deterministically.
