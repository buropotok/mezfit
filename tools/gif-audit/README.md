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
   `github_only.csv`, `review.html`, `summary.md`, and
   `control-30-evaluation.csv` (v2).
   The GIF files themselves stay permanently in Git history on the data branch.

The report HTML loads both animated GIFs from GitHub raw URLs. It requires
network access (and repository authorization if the repository becomes private).
The source repository is currently public: committing the R2 snapshot branch
makes these R2 GIF copies publicly accessible. The owner has approved reusing
the already-uploaded exercise GIF library (see `docs/operations/public-exercise-media.md`).

## Comparison details and limits (v2 motion-retrieval pilot)

GIF frames are sampled at 16 points in animation time, normalized, and kept
in memory only while a single audit runs. **Candidate retrieval uses independent
visual and optical-flow channels**: either modality can bring a pair into the
final shortlist. Both directions are searched to reduce loss of candidates.

- Visual channel: mean/variation/contour descriptors; frame-wise DCT hashes,
  cyclic phase shift, DTW and grayscale SSIM.
- Motion channel: dense Farnebäck optical flow on successive frames, ignoring
  pixel changes below a compression-noise threshold, coarse spatial velocity
  fields, movement-direction histograms and cyclic temporal comparison. This
  channel is less sensitive to the drawn athlete's appearance or fixed logos.
  It does **not** claim to detect anatomical joints or identify a given exercise.
  Extremely static clips return no reliable motion score and use the visual
  channel alone.
- Fused similarity: 70% visual + 30% motion when motion is available, otherwise
  visual alone. These weights are experimental, not calibrated probabilities.
  Final 1:1 pairing still uses global assignment, mutual-best and margin checks.

The CSV outputs `matches.csv` and `review.csv` contain fused `score` and
separate `appearance_score`/`motion_score` for inspection. A new
`control-30-evaluation.csv` measures the algorithm against the **30 decisions
provided by the owner on 2026-11-01**. It reports whether each manually
reviewed pair was retrieved, its individual channel scores and whether
the algorithm accepted the pair. The decisions are evaluation-only: they are
never used to retrieve, rank, automatically match, or set thresholds. This
nonrandom sample is useful for regression diagnostics, not for estimating
dataset-wide precision.

Default thresholds remain **provisional**: auto match `>=0.86` with
margin `>=0.035`; candidate review `>=0.62`. A high fused score is **not**
proof that two GIFs contain an identical source animation. The categories
distinguish provisional auto matches, unresolved candidates, and files with
no shortlisted plausible candidate; `only` is not proven uniqueness.
Fixed corner masks may not remove a watermark in the center; different
models, camera crops or frame timing can still require manual review.

A future *separately evaluated* increment may use pose keypoints (MediaPipe)
and visual embeddings (DINOv2) for difficult male/female redraws. Those
models are **not installed or invoked in v2**: no external model download,
GPU, new secret or mandatory AI inference is introduced into GitHub Actions.
Do not adjust labels/tests to fit arbitrary scoring thresholds.

No source repository GIFs, R2 objects, D1 indexes, Dexie Cloud catalogue rows,
exercise metadata, Worker routes, API tokens or deployment settings are edited.
