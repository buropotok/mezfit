# GIF Manual Matching — operator-only GitHub Pages tool

Goal: first manually review the frozen 419 visual-only provisional pairs from
the pinned GIF audit. For each FitnessProgramer GIF, display its independent
visual-audit partner first, then up to four different GymVisual/R2 candidates
retrieved by English title, instructions, equipment and muscles. No match is
automatically confirmed. The other 749 GIFs remain accessible via the queue
selector; the original 1,168/1,324 inventories are unchanged.
This never changes exercise definitions, R2, the app, or Dexie Cloud.

## Hosting and deployment

- Source: tools/gif-review-pages/site/index.html.
- Generator: tools/gif-review-pages/build_data.py (Python 3 standard library).
- Deployment: .github/workflows/deploy-gif-review-pages.yml.
- On merge to main, the dedicated workflow publishes the standalone static site.
- Media URLs are pinned to the checkout commit SHA; candidate ranking is fingerprinted
  by candidate_revision. Changes to catalogues do not automatically overwrite a
  review session in progress; only the operator workflow/source changes or an
  explicitly dispatched rebuild republish the candidate data.
- Repository owner must enable **Settings → Pages → Build and deployment →
  GitHub Actions**. Until this is enabled and the publishing workflow succeeds,
  the proposed https://buropotok.github.io/mezfit/ address is NOT live.
- For a manual rebuild use Actions → Publish GIF manual review (GitHub Pages)
  → Run workflow and specify a successful all-scope GIF audit run ID. The default
  is run 41322174596; its gif-visual-delta-report artifact expires after
  GitHub retention. If it expires, run the GIF audit again and supply the new ID.
- The Pages workflow downloads that artifact with the built-in, read-only
  GITHUB_TOKEN. No Cloudflare, Dexie, secrets or privileged publication APIs.

**Pages caution:** Each repository has one Pages site. This workflow publishes
the repository's Pages root. Do not enable it if an unrelated site currently
occupies that address without explicitly deciding to replace that site.

## Candidate provenance and limits

- Target GH GIFs: assets/media/*.gif; EN names come from
  assets/exercises/**/*.json matched by image_id, not category rows.
- Source R2 GIFs: the immutable data/r2-gif-snapshot branch under
  audit/gif-sources/r2/[four-digit-id].gif. EN names/equipment come from
  audit/visual/input/catalogue_stage_01..14.jsonl.
- The 1,324 R2 English names were separately checked equal to all 1,324
  name_en in the user-supplied catalogue 2.1.0 (SHA-256
  ee0f313fa15dd8a35a7e6cc558ccd6012810128948e8c8a9e6b5381bf6449c66).
  This does not verify that every other field agrees with 2.1.0; the full
  2.1.0 JSON is not included in this repository.
- Candidate evidence uses English exercise names normalized for common
  morphology, variants, synonyms and movement terms, plus the pinned GIF
  audit's matches.csv, review.csv and pose-candidates.csv.
- **Visual-first review v3:** pinned `matches.csv` contains exactly 419 unique
  GH↔R2 provisional 1:1 visual hypotheses, obtained **without names or exercise
  metadata**. The primary is always candidate #1, even when its metadata conflicts.
  Its original fused visual score is displayed as an *uncalibrated score*, never
  as a probability. Conflicting apparatus or movement is flagged for human review,
  not silently discarded. The queue starts with these 419 pairs, ordered by their
  visual-audit score.
- Up to four alternatives are independently retrieved from all 1,324 metadata
  rows: normalized English name, description/instructions, equipment and target
  muscles. Alternatives with explicit apparatus/movement contradictions are not
  promoted. The list may contain fewer than five total cards if the evidence is
  weak; we do not fill slots with unrelated exercises.
- The existing v2 ranker remains available for the other 749 exercises and for
  later rounds, but its candidates cannot displace the first-round visual primary
  or the four metadata alternatives in the dedicated review queue. Later rounds
  omit already displayed first-round choices. All suggestions remain human-only.
- evidence.csv exposes semantic-title scores, category and independent
  visual support. Scores are NOT calibrated match probabilities.
- The v3 alternatives use deterministic text token overlap and typed metadata;
  this is **not** LLM inference or a calibrated semantic similarity model. The
  underlying visual matches, review and pose reports remain independent and
  unmodified. We do not use human control labels to tune or automatically
  accept matches.
- The original 15 human reference pairs are not tuning input and do not
  authorize an automatic match. Prior audit label proposals, e.g. renaming
  Wheel Run, are never applied. Actual matching decisions are human.
- Generated candidates.json retains all 1,168 GH exercises and the legacy
  top 30 per GIF for backward compatibility. The 419 visual items additionally
  have `visual_candidates` (1 visual primary + 0–4 metadata alternatives);
  this replaces **only** their first-round display. The remaining rounds use
  their legacy ranked candidates, omitting first-round choices. evidence.csv
  retains the original v2 scoring evidence. Workflow also publishes the
  downloadable gif-review-candidates artifact. A new fingerprint identifies the
  review ordering; old local decisions remain in their earlier revision.
- The published ranking includes the 1,324-item R2 identifier lookup
  exclusively for validating and displaying owner-verified historical matches.
  An owner choice can remain confirmed even if a later ranking no longer
  includes that GIF among its first 30 suggestions.

## Operator use

1. The default queue is **419 визуальных пар**. For every source GIF the first
   candidate comes from the visual-only audit. Up to four candidates on its
   right come from name/instruction/equipment/muscle retrieval. Confirm a GIF
   only after looking at the animations; the choice saves locally and advances.
   The separate queue selector can show the other 749 or all 1,168 exercises.
2. If no shown GIF matches, click "Нет совпадения среди показанных". Such
   items are eligible for round 2; a skipped item does not advance to the next
   round. A visual-audit metadata conflict is a warning, not an automatic
   rejection of a potentially identical animation.
3. Use the round picker to inspect rounds 2–6. Each next round presents the
   next five previously unseen candidates for items marked "none" through
   every preceding round.
4. Use "Выгрузить CSV" regularly to make an offline backup. GitHub Pages
   cannot persist decisions on the server. Browser-local storage can be lost,
   is not shared across devices, and may fail in restricted/private contexts.
5. Use "Импорт CSV" on the same or another device to restore decisions.
   Import validates GIF names, candidate IDs, round order and statuses. It
   replaces the current local set only after confirmation. It does not upload
   files to any server.
6. Revisit any prior decision, change it or reset it. Changing an earlier round
   discards stale later-round choices for the same GH GIF.

CSV schema:
candidate_revision,github_gif,github_name_en,round,status,r2_id,r2_gif,r2_name_en,updated_at.
CSV import of the current candidate_revision restores the full set of
matching/none/skip decisions. On a different candidate_revision, the site
offers **explicit selective migration of confirmed matches only** from the CSV.
The same explicit option is offered for valid, locally saved matches from
earlier versions. Existing current decisions are not overwritten; old browser
keys and CSV remain unchanged. A migrated match absent from the current five
is displayed separately with its R2 GIF. No-match and skip decisions are
never migrated because the displayed five are different and require review.
Each ranking has its own localStorage key. Export CSV regularly; browser data
is not a durable backup.
status is one of matched, none, skip. Multiple GH GIFs may select the same R2 GIF;
the tool does not enforce 1:1 matching. Unreviewed GH GIFs have no CSV row and
are not silently treated as nonmatches.

## Security, scope and review

This is a separate static operator tool, not a React/Telegram Mini App
screen and not a Konsta UI Kit component. It uses native browser controls
rather than modifying or reimplementing any app UI Kit primitive. GIFs are
loaded from public GitHub raw URLs. No private data, credentials, telemetry,
external AI endpoint or server-side write path exists.

After committing changes, review source against root AGENTS.md and the
application audit before proposing PR. No local npm/typecheck/test execution:
the existing app's CI runs after the PR is opened.
