# FitnessProgramer — Stage 2 consolidation

This branch collects all twelve batches without publishing or changing app code, source JSON, GIFs or Dexie Cloud.

* `consolidated-index.json`: **1,173** unique candidate records with proposed patches, ID, source path/SHA and originating batch. This is not the fully materialized exercise card. No original source data is silently replaced.
* `parts/part-1.json` and `parts/part-2.json`: full 1,173 results with evidence/URLs and notes; split into two readable files for connector size limits.
* `source-snapshot.json`: immutable commit/blob SHA provenance. B001 is the reprocessed result. At capture, B011 had a complete 100-row result file but was still `in_progress` in queue; it remains provisional until status reconciliation.
* `qa-core.json`: source-ID, SHA, taxonomy and structural validation (0 structural issues). `other` is an intentional research marker, not yet a real muscle taxonomy identifier.
* `equipment-candidates.json`: 110 original proposal occurrences grouped by exact normalized ID (underscore/space/hyphen folding); Russian names and evidence preserved. These are **not yet approved filters**.
* `equipment-audit.json`: conflicts, duplicate labels, unreferenced proposals and unmatched equipment values. No semantic merge is silently applied.

Next: review equipment duplicates and decide canonical filter ID/label in a **separate PR**, then prepare safe publication of effective Base 2 exercise cards and review in the Mezfit UI. No npm/test/build commands were run as required by the project.
