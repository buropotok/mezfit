# GIF visual delta audit

This is an operator-only, read-only comparison of **media bytes**, not exercise records.
A GIF in one source can have at most one confirmed partner in the other source.
Names, numeric IDs, and taxonomy are never features of the matcher.

## Source inventory and persistence

- **R2:** the existing `mezfit` bucket, pinned `github_exercises_dataset` media
  version from `shared/approved-exercise-media.json`. The 1324 four-digit R2
  object keys come from the frozen `audit/visual/audit_execution_plan.json`
  inventory **solely to locate objects**, not to associate exercises.
- **GitHub:** all `assets/media/*.gif` files from current `main`.
- Permanent R2 GIF snapshot: `audit/gif-sources/r2/` on the separate
  `data/r2-gif-snapshot` branch, committed by the manual workflow.
  This branch is created once and reused without overwriting its media.
  R2 and D1 are never modified by this workflow.

## Operator steps

1. Merge the reviewed PR into `main` after CI. The new Action is not executed
   by merging; it requires manual owner dispatch.
2. GitHub **Actions → Audit GIF libraries (R2 vs GitHub) → Run workflow** on
   `main`, select `snapshot-and-audit`. Existing `CLOUDFLARE_API_TOKEN`
   must permit read access to the `mezfit` R2 bucket.
3. The first run downloads and validates the pinned objects, commits the GIFs
   to `data/r2-gif-snapshot`, then starts comparison in a separate read-only job.
   If comparison fails, the branch with downloaded GIFs remains available.
   An incomplete download fails without publishing a snapshot branch.
4. For later runs select `audit-only`: it reads the permanent snapshot branch,
   needs no Cloudflare token and does not update any Git branch.
5. Download the `gif-visual-delta-report` Action artifact (30-day retention).
   It contains `matches.csv`, `review.csv`, `r2_only.csv`,
   `github_only.csv`, `review.html`, and `summary.md`.
   The GIF files themselves stay permanently in Git history on the data branch.

The report HTML loads both animated GIFs from GitHub raw URLs. It requires
network access (and repository authorization if the repository becomes private).
The source repository is currently public: committing the R2 snapshot branch
makes these R2 GIF copies publicly accessible. The owner has approved reusing
the already-uploaded exercise GIF library (see `docs/operations/public-exercise-media.md`).

## Comparison details and limits

Frames are sampled at 16 points in animation time, resized preserving aspect
ratio, with fixed corner masks for watermarks. A mean/variation/contour image
descriptor finds candidate pairs across both libraries. Per-frame DCT hashes
identify cyclic phase offset; DTW aligns changed timing; SSIM verifies actual
grayscale-frame structure. One-to-one matching is solved with unmatched dummy
slots and a conservative mutual-best and margin acceptance check.

Default thresholds are **provisional**: confirmed `>=0.86` with margin `>=0.035`;
candidate review `>=0.62`. Review entries are **not** treated as unique GIFs.
The result is a candidate audit, not a guarantee of zero false positives or
false negatives. Calibrate on visually reviewed pairs before using confirmed
matches in a migration. Fixed corner masks may not remove a watermark in the
center; source GIFs with different crops or substantial re-timing may still
require manual review. Do not modify tests to fit arbitrary thresholds.

No source repository GIFs, R2 objects, D1 indexes, Dexie Cloud catalogue rows,
exercise metadata, Worker routes, API tokens or deployment settings are edited.
