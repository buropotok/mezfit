# FitnessProgramer — Stage 2 consolidation

This branch collects all twelve batches without publishing or changing app code, source JSON, GIFs or Dexie Cloud.

* `consolidated-index.json`: **1,173** unique candidate records with proposed patches, ID, source path/SHA and originating batch. This is not the fully materialized exercise card. No original source data is silently replaced.
* `parts/part-1.json` and `parts/part-2.json`: full 1,173 results with evidence/URLs and notes; split into two readable files for connector size limits.
* `source-snapshot.json`: immutable commit/blob SHA provenance. B001 is the reprocessed result. At capture, B011 had a complete 100-row result file but was still `in_progress` in queue; it remains provisional until status reconciliation.
* `qa-core.json`: source-ID, SHA, taxonomy and structural validation (0 structural issues). `other` is an intentional research marker, not yet a real muscle taxonomy identifier.
* `equipment-candidates.json`: 110 original proposal occurrences grouped by exact normalized ID (underscore/space/hyphen folding); Russian names and evidence preserved. These are **not yet approved filters**.
* `equipment-audit.json`: conflicts, duplicate labels, unreferenced proposals and unmatched equipment values. No semantic merge is silently applied.
* `equipment-canonical.json`: 109 canonical entries covering the 82 agent candidate IDs and existing equipment values, plus the approved `walk-wave-machine` replacement. Preserves original ID spellings and Russian label alternatives; records 3 approved semantic merges, 5 deliberately distinct pairs, 6 approved Russian names and 5 existing UI-label alias groups. This is reference data, not a deployed filter or a change to source exercises.
* `equipment-other-resolutions.json`: all 12 approved replacements for candidate `equipment: other` cases, keyed by the exact original exercise ID. The original agent research patches remain untouched; the replacements are ready to apply during the subsequent integration step.

Next: apply the approved equipment dictionary and exercise-specific `other` replacements in a **separate integration/filter PR**, then prepare safe publication of effective Base 2 exercise cards and review in the Mezfit UI. No npm/test/build commands were run as required by the project.
