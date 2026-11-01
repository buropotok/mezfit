# GIF visual delta audit

This is an operator-only, read-only comparison of **media bytes**, not exercise records.
A GIF in one source can have at most one provisional automatic 1:1 partner in the other source.
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
   needs no Cloudflare token and does not update any Git branch. Choose
   `pose_scope=controls` for the first MediaPipe pilot; only use
   `pose_scope=all` if pose detection is useful on real examples.
5. Download the `gif-visual-delta-report` Action artifact (30-day retention).
   It contains `matches.csv`, `review.csv`, `r2_only.csv`,
   `github_only.csv`, `review.html`, `summary.md`, and
   `control-30-evaluation.csv` (v2). When `pose_scope` is enabled, the
   report additionally contains `pose-control-30.csv` (including
   `joint_motion_score`) and `pose-coverage.csv` (`detected_frames_of_16`);
   the `all` scope also produces `pose-candidates.csv` with independent
   retrieval channels and manual-review candidates.
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

## Optional MediaPipe Pose Landmarker audit (v3 pilot)

The manual workflow offers an additional `pose_scope` input:

- `controls` (default): run Google's MediaPipe Pose Landmarker **Lite** on
  only the 30 owner-reviewed pair examples (up to 60 distinct GIFs).
  Emit `pose-control-30.csv`, `pose-coverage.csv` and Job Summary statistics
  for measurable positive/negative pairs, including **separate static pose
  and angular movement scores**. Never tune thresholds on this nonrandom sample.
- `all`: extract poses from all **1324 R2 + 1168 GitHub GIFs**, then perform
  independent bidirectional **pose-position and joint-motion** retrieval.
  `pose-candidates.csv` shows both scores and which channel retrieved/ranked
  the pair. Job Summary reports annotated positive-pair **Recall@5/10/20**
  for each channel on the full cross-library search space (R2→GitHub only).
  These 15 known-positive examples are diagnostic, not an unbiased population
  performance estimate. All candidates remain **review-only**.
  CPU runtime increases substantially; missing skeletons cannot establish uniqueness.
- `off`: preserve v2-only analysis (no MediaPipe installation/download).

MediaPipe is installed **in a dedicated Python virtual environment**, only on a
manual run with pose enabled: `mediapipe==0.10.32` in
`requirements-pose.txt`, Python 3.12. This avoids mixing its OpenCV packages
with the base visual matcher. The model is
downloaded directly from Google's versioned Lite task URL and verified against
SHA-256
`59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a`.
The CPU model runs against decoded GIF frames on the Actions runner. No exercise
names, numeric IDs or metadata influence the pose embedding or retrieval.

Each audit GIF now contributes **16** evenly spaced frames (previous pilot:
8), each frame 320×320 with preserved aspect ratio. The model returns up to 33
landmarks; comparison uses 12 shoulder/elbow/wrist/hip/knee/ankle landmarks
normalized to torso size. The original position-based comparison remains
available separately. The new deterministic joint-motion channel computes the
eight left/right elbow, shoulder, hip and knee angles, robust joint excursions,
and a bounded cyclic Dynamic Time Warping distance. Joints that move in either
clip receive increased weight. Candidate discovery uses separate position and
angle-motion vectors and includes mirror-invariant retrieval. For unreliable
joint sequences and static/isometric clips, motion is reported **unavailable**,
not zero or proof of nonmatch.

Both pose channels are *diagnostic*: there is no global score averaging with
SSIM/Optical Flow, no automatic 1:1 assignment and no model confidence
interpreted as a match probability. Pose scores are uncalibrated and require
manual verification; MediaPipe is trained primarily on real people and may fail
on drawings/athletic anatomy. Angles do not identify equipment or exercise
intent. A real male/female-specific validation set is still needed before
these channels can influence automatic matching.

**This pilot does not modify v2's similarity weights, matches.csv, delta lists,
R2 objects, original GitHub GIFs, or persistent R2 snapshot branch.** Pose
scores are deliberately separate. Only after measuring real-world coverage and
held-out accuracy should pose features be considered for automatic matching.
DINOv2 is not included.

Do not change test assertions or manually reviewed labels to fit desired scores.

No source repository GIFs, R2 objects, D1 indexes, Dexie Cloud catalogue rows,
exercise metadata, Worker routes, API tokens or deployment settings are edited.
