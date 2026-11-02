# GIF Manual Matching — operator-only GitHub Pages tool

Goal: manually map each of the 1,168 FitnessProgramer GIFs to the best of five
GymVisual/R2 GIF candidates (1,324 source GIFs), or mark "none" / "skip".
This never changes exercise definitions, R2, the app, or Dexie Cloud.

## Hosting and deployment

- Source: tools/gif-review-pages/site/index.html.
- Generator: tools/gif-review-pages/build_data.py (Python 3 standard library).
- Deployment: .github/workflows/deploy-gif-review-pages.yml.
- On merge to main, the dedicated workflow publishes the standalone static site.
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
- Candidate evidence uses independent title-similarity retrieval in both
  directions and the pinned GIF audit's matches.csv, review.csv,
  pose-candidates.csv. Independent channels are combined using rank fusion.
  Retrieval scores are NOT probabilities or proof of equivalence.
- The original 15 human reference pairs are not tuning input and do not
  authorize an automatic match. Prior audit label proposals, e.g. renaming
  Wheel Run, are never applied. Actual matching decisions are human.
- Generated candidates.json holds the top 30 candidates per GH GIF, enabling
  six rounds of five candidates without regenerating the site. evidence.csv
  records channel ranks, original scores and fusion ordering. Workflow also
  publishes a downloadable gif-review-candidates artifact.
- No claim of completed semantic LLM verification: the ranking uses lexical
  titles plus precomputed visual/optical-flow/pose/joint-motion signals.
  A future separately reviewed candidate source may improve the ranking.

## Operator use

1. Select a GIF from the second library; click one of five GIF cards from the
   first library. The decision saves locally, then advances to the next item.
2. If no GIF matches, click "Нет совпадения среди пяти". Such items are
   eligible for round 2; a skipped item does not advance to the next round.
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
github_gif,github_name_en,round,status,r2_id,r2_gif,r2_name_en,updated_at.
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
