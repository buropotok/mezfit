# WorkedMuscles: static atlases and idle cache warm-up

The approved front/rear anatomy is rendered from static PNG atlases, not by filtering
pixels in the Telegram WebView.

## Canonical source and generated files

Source artwork and masks are tracked in Git:

- public/anatomy/male-front.png, male-front.mezmask (1024×1536)
- public/anatomy/male-rear.png, male-rear.mezmask (1122×1402)
- src/workout/workedMuscleData.ts (view-specific ID to semantic muscle ID)

The approved front mask (3) differs from the tracked initial mask by 23,284
abdominal pixels: inside rect x=435..585, y=421..602, the old ID 12 belongs
to ID 6. This correction is applied once during asset generation.
The script checks the exact input SHA-256 and expected number of pixels.
The generated hit-test mask is not stretched or reinterpreted.

The approved neutralization is precomputed at 84% for front and 59% for rear.
Color sprites preserve the original texture. Glow is blurred before PNG encoding.
No filters or pixel loops run on a component redraw.

Run node scripts/build-anatomy-atlases.mjs before Vite dev/build.
It emits static files under:

- public/anatomy/atlas/front-v3/
- public/anatomy/atlas/rear-v1/

Each contains neutral.png, color-atlas.png, glow-atlas.png, mask.mezmask and
manifest.json. Binary outputs are reproducible build artifacts and are not
checked into Git; during Vite build they are deployed as regular static files.
They are never generated on the user's device.

If artwork, masks or sprite construction changes, review the approved output,
update source hashes, and bump the versioned output folder in both the
generator and src/workout/workedMuscleAtlas.ts. Never silently overwrite
an immutable-cache resource under the same versioned URL.

## Runtime and failure behavior

The authenticated application mounts WorkedMuscleAtlasPreload. It starts
warming during browser idle time (with a timeout fallback for WKWebView).
Loading and decoding run asynchronously and do not block the shell.

The loader owns one in-memory single-flight Promise per view. The background
warmer and visible component reuse the same decoded image objects.
Requests also use the browser's HTTP cache; no Service Worker, CacheStorage,
Dexie records or duplicate media database are introduced.

A view starts its own request if warming did not finish or cache was evicted.
A failed Promise is removed so a later mount can retry. Persistent browser
caching is best effort: Telegram WebView or the OS may evict it.

At display time React only composites background, pre-blurred glow sprites and
color sprites. Primary role has priority; secondary draws with reduced alpha.
The MEZMASK1 is used only for exact tap hit testing, never for drawing.
Tap shows a persistent label below the figure; hover is not required.
