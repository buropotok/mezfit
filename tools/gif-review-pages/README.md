# GIF Manual Matching — operator-only GitHub Pages tool

Goal: support a human-confirmed review of the **749 remaining FitnessProgramer GIFs**
after the owner confirmed all 419 original visually selected pairs. The default
queue now sorts these 749 by available visual evidence, strongest first.
For every source GIF it presents the highest-scored visual hypothesis followed
by up to four independently retrieved metadata alternatives. The 419-pair
queue remains accessible separately. No decisions are written automatically.
The original 1,168/1,324 inventories are unchanged, as are exercise data,
R2, the app, and Dexie Cloud.

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
- **Remaining visual queue v4:** exclude the original 419 from the default
  review queue. The other 749 are shown in deterministic evidence tiers:
  **530** have a fused appearance/motion score from `review.csv` (score descending);
  **213** have no reported fused score but have independent static-pose evidence
  from `pose-candidates.csv` (pose score descending, separately labelled);
  **6** have neither measure, and are placed last without an invented score.
  This is *not* one numerically comparable probability scale. The last six may
  still have semantically retrieved candidates, which are never presented as
  visual matches.
- In each remaining GIF, the highest-scoring candidate in its evidence channel
  is **card #1** even if metadata contradicts the image (the conflict is shown
  to the reviewer). Up to four alternatives follow from the existing semantic
  ranker. Where no visual candidate exists, up to five independent metadata
  alternatives can appear; some GIFs may have no plausible options at all.
- The legacy v2 top-30 remains available for follow-up rounds and the historic
  evidence export; candidates already shown in round one are omitted from later
  rounds. No human verification is inferred from a visual score.
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
  top 30 per GIF for backward compatibility. The 419 original visual items
  still have `visual_candidates`, and the other 749 now have
  `remaining_candidates` and `remaining_priority` with evidence type, score
  or explicit null. Only the **first-round** display changes. Later rounds
  use previously generated candidates, excluding first-round cards.
  `evidence.csv` remains unchanged in meaning. A new fingerprint identifies
  the revised order; old local decisions remain in their own revision.
  Confirmed older decisions may be imported or explicitly migrated.
- The published ranking includes the 1,324-item R2 identifier lookup
  exclusively for validating and displaying owner-verified historical matches.
  An owner choice can remain confirmed even if a later ranking no longer
  includes that GIF among its first 30 suggestions.

## Operator use

1. The default queue is **749 оставшихся · по сходству**. Sources with
   comparable fused GIF scores appear first, sorted by score descending,
   followed by pose-only sources and those without visual evidence. For a
   source with visual evidence its best visual candidate is first, followed
   by up to four metadata alternatives. The queue selector still exposes the
   original 419 and all 1,168 exercises. No match is silently accepted.
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


## Data integrity and score interpretation

The two evidence tiers must not be mixed into a fictitious common probability.
The source report did not retain fused appearance/motion scores below the 0.62
review threshold for 219 GitHub GIFs. Computing an exact fused-score rank for
all 749 therefore requires a **new** audit run that explicitly exports the
below-threshold best candidate scores. The current site transparently places
that group after the 530 originally scored items, using pose only as a fallback.
The original 419 remain available, regardless of whether their manual decisions
were imported into the local browser. Owner confirmation in chat does not
silently populate `localStorage` or mutate exercise catalogue records.

The GitHub Actions input artifact (run 41322174596) has retention; if it
expires, publishing must use a new explicitly reviewed source artifact rather
than fabricate or silently change scores. Review and export existing decisions
before any source revision.

## Security, scope and review

This is a separate static operator tool, not a React/Telegram Mini App
screen and not a Konsta UI Kit component. It uses native browser controls
rather than modifying or reimplementing any app UI Kit primitive. GIFs are
loaded from public GitHub raw URLs. No private data, credentials, telemetry,
external AI endpoint or server-side write path exists.

After committing changes, review source against root AGENTS.md and the
application audit before proposing PR. No local npm/typecheck/test execution:
the existing app's CI runs after the PR is opened.
