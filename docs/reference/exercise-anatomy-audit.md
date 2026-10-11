# Exercise anatomy catalogue — review draft (v1)

**Repository:** `buropotok/mezfit`  
**Scope:** 1,324 public upstream exercise definitions, not coach-created or client-created exercises.  
**Artifact:** `data/exercise-anatomy-v1.json`  
**Status:** `audit_draft_not_for_production_import`. **Do not import into D1/Dexie Cloud or display these labels as approved until records are reviewed.**

## Purpose

This is an identity-preserving inventory of all 1,324 source entries with proposed Russian names and movement-specific classification. It separates `primary` (target muscle or group), `secondary` (assisting muscles), `stabilizers` (position or joint stabilizers), and `regional_emphasis` (heads/regions/functional training zones). A region is **not** an isolated muscle; do not award separate training volume to a parent group and its head/zone. The per-exercise \`anatomical_parts\` dictionary lists anatomical child structures of targeted/assisting/stabilizing groups; it is **not** a claim that every child is equally activated. Unlike ordinary muscle IDs, `upper_chest`, `middle_chest`, `lower_chest`, `upper_abs`, and `lower_abs` are training zones.

Definitions (including the stabilizer/fixator distinction) follow OpenStax: https://openstax.org/books/anatomy-and-physiology/pages/11-1-interactions-of-skeletal-muscles-their-fascicle-arrangement-and-their-lever-systems

Research informing **specific** tentative emphasis:
- Overhead triceps extensions and the long head: Maeo et al., *Eur J Sport Sci* 2023, https://pubmed.ncbi.nlm.nih.gov/35819335/
- Bench variations and shoulder/chest activation: Barnett et al., *J Strength Cond Res* 1995, https://doi.org/10.1519/00124278-199511000-00003. Findings are not a universal guarantee of greater activation for each angle, technique or individual.

## Provenance

Canonical input: https://github.com/hasaneyldrm/exercises-dataset/blob/main/data/exercises.json  
Pinned Git blob: `3cbb77b678c40d7342897d38e4c61e9502f829a7`.

Each exercise retains:
- `source_id` exactly as the upstream zero-padded string; never deduplicate by name or replace references by a display label;
- upstream `name_en`, `target`, `muscle_group`, `secondary_muscles`, `body_part`;
- **verbatim English movement instructions**, used as contextual review evidence, not as a promise of a correct original description;
- `name_ru` as a **candidate** and explicit `name_status`;
- `review.status = needs_expert_review` and `review.external_match = unverified` — there has NOT been a one-by-one independent exercise-directory match for every entry.

The upstream JSON was analyzed as an entire 1,324-record source. Names and muscles were produced with source metadata, action templates, and a targeted terminology pass. The machine did not individually verify all 1,324 translations on the internet, and it would be misleading to present this as completed clinical/anatomical approval.

## Coverage snapshot

| Exercise kind | Count |
| --- | ---: |
| Strength | 1230 |
| Mobility/stretching | 56 |
| Conditioning/cardio | 29 |
| Skill | 9 |
| **Total** | **1324** |

| Russian-name review tier | Count | Meaning |
| --- | ---: | --- |
| `curated_rule` | 133 | Explicitly edited name or well-established movement-language rule; still not independently source-verified |
| `rule_candidate` | 646 | Movement-template draft |
| `rule_draft` | 249 | Movement template leaves material variant details unresolved |
| `legacy_draft` | 296 | Old automatic translation retained as **unapproved draft**; these contain known unnatural names |

The 76 taxonomy identifiers include actual muscles, muscle groups, heads/regions and practical training zones. Category is compatible with existing nine-category codes, but there is **no production schema/UI change in this task**. Detailed categories are proposed data for a separate integration decision. User overrides and historical exercise references remain untouched.

## Interpretation and limitations

1. **Strength**: source target is a starting hypothesis about the primary loaded tissue, not an objective EMG ranking; `secondary_muscles` does not itself distinguish dynamic synergy from stabilization. Roles derived from it are provisional.
2. **Mobility**: `primary` is the **tissue being stretched** rather than a contracting prime mover. Do not aggregate mobility sessions into strength-volume totals.
3. **Cardio**: cardiovascular system is not a skeletal-muscle ID; a particular muscle is deliberately not fabricated as `primary`.
4. **Anatomical head membership**: \`anatomical_parts\` enumerates constituent structures (such as the three triceps heads) separately from any directional training emphasis. Do not treat membership alone as experimental activation data.\n5. **Stabilizers**: only an identifiable movement/stance context leads to an inferred stabilizer. Empty list means **not established**, not that no stabilizer participates.
6. **Heads**: the triceps long head can be accentuated by an overhead position, but the lateral and medial heads also contribute; a head emphasis does not mean exclusive recruitment. Likewise lower chest is an emphasis zone, not a unique independent muscle.
7. **Quantification**: `regional_emphasis` has no numeric weights. Actual relative loading depends on technique, range of motion, joint angles, training load, fatigue and anthropometry.
8. **Verification**: `name_ru` should not replace canonical product names unless an exercise-by-exercise expert review verifies the name against the original instructions, media, and independent terminology sources.

## Review process necessary before release

1. Match by **source ID**, compare English name, instructions and GIF; identify source records whose descriptions conflict with the movement name.
2. Look up a conventionally named equivalent in reputable exercise directories. Record a precise exercise URL and whether the match is exact or only approximate; if unresolved, keep `needs_expert_review`.
3. Edit the Russian name in natural coach/athlete terminology, retaining significant bench angle, movement plane, grip, equipment, limb and assisted/weighted variation.
4. Assess prime movers, synergists and stabilizers separately. Annotate head/region emphasis only with adequate biomechanical support. Check compound exercises and stretches carefully.
5. Run the integrity checker `node tools/validate-exercise-anatomy.mjs` as part of **a future review workflow**. It verifies IDs and structural integrity only, not anatomical validity.
6. Accept records individually; only after complete review design the typed catalogue/repository migration and UI filter logic in a separate PR. Do not mutate the global catalogue or user overrides in this draft PR.

## Risk boundaries

- The file is large by design and is **not imported by the application**. It must not become a startup JSON import or be bundled into the Telegram Mini App.
- No code in `worker`, `src`, `migrations`, or Dexie Cloud configuration changes here.
- Coach/client access, program exercise references, historic facts, local-first synchronization and stable IDs are unchanged.
- Pre-PR source review of existing exercise catalogue tests is required; this data draft does not invalidate or change those tests.
