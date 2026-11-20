# MIG-05 · MezfitImportPlan v1

`migration/import-plan/index.ts` exports
`buildMezfitImportPlan(sourceInput, configInput)` and
`validateMezfitImportPlan(value)`. Both are asynchronous for SHA-256 through Web
Crypto. The exact wire shapes and inferred types are in
[contracts.ts](../../migration/import-plan/contracts.ts). The engine
produces a private preview from MIG-04 facts and read-only snapshots. It runs
independently of the migration Worker entry point, the processor workflow,
Dexie repositories and UI.

## Inputs and evidence

| Input | Evidence required |
| --- | --- |
| Source package | Exact MIG-04 v1 shape, graph and required source issues. JSON is bounded before invoking the existing validator. |
| Period | Explicit inclusive `fromDate` and `throughDate` in YYYY-MM-DD, IANA selection zone and a fixed UTC evaluation instant. Resolve relative periods before calling the engine. |
| Dataset key | Opaque stable namespace assigned by the caller for the same source dataset across exports. The engine cannot prove cross-export source identity. |
| Target snapshot | One context per known source subject. Existing clients use an opaque context and active-program state; provisional imported clients use an opaque planning reference. Missing entries yield unresolved bindings. |
| Catalogue snapshot | Eligible catalogue entries with target ID, name, confirmed tracking type, and optional equipment and movement type. Caller resolves visibility before producing the snapshot. |
| Mapping snapshot | Previously approved source exercise identity → catalogue ID. Entries are accepted only if the target is in the supplied catalogue and its tracking type agrees with available source evidence. |
| Occupancy snapshot | Half-open UTC intervals from the coach's calendar covering all relevant clients. Supply all applicable occupied intervals for the selected date range. |
| Existing imports snapshot | Previously accepted group keys in the same target context. Replay skips those groups and never overwrites existing FACT. A previously imported dependency remains represented by its group key. |
| Excluded groups | Explicit group keys withheld from this dry-run. A dependent candidate blocks when an indispensable dependency was excluded. |

A missing snapshot has a `null` hash and an unresolved diagnostic. An empty
array is an explicit empty snapshot. A provided snapshot describes what the
caller submitted. Future publication must separately verify target identity,
snapshot currency, authorization, target integrity, and the coach's approval
of the exact selections and losses.

## Selection and representation

- Dates come from the original local date or a trusted UTC instant with the
  source zone. An unknown date or disagreement between the supplied local date
  and the instant in its source zone blocks the affected group. The selection
  zone documents how the period was chosen.
- Every explicit session-to-appointment link in the package suppresses a
  standalone appointment candidate in the selected period. This includes
  sessions outside the period. Incomplete session coverage or unresolved
  session links block otherwise unrepresented appointment candidates. Source
  identity determines linkage.
- Selected workouts pull complete programs by explicit, consistent links.
  Source phases, days, exercises and sets retain positions. Existing active
  program conflicts block the program and its dependent groups. Source
  programs have undecided activation. A proven programless subject receives a
  separate proposed active program of one phase and one day from the latest
  unambiguous completed session. Inferred hours do not establish recency.
- Structural program sets contain no numerical PLAN. Source attributes are
  retained in loss evidence. A schedule retains its own PLAN. A session
  carries its own frozen PLAN alongside independent FACT and lifecycle.
  Standalone historical Ad-hoc can carry FACT alone. Source labels and set
  types remain visible in the private plan, with a loss entry for unsupported
  values.
- Exact catalogue matching uses the name, tracking type, equipment and
  movement type together. The string fingerprint uses NFC, trimmed and
  collapsed whitespace, and lowercase. Zero or several matches result in a
  proposed custom exercise when source name and tracking evidence meet current
  requirements. The central mapping includes the follow-up reconciliation
  marker. An unresolved definition blocks the dependent workout or program.
- Weight is in kg, duration in seconds and distance in metres. Conversion uses
  the unit factors in [measures.ts](../../migration/import-plan/measures.ts)
  and IEEE-754 multiplication without extra rounding. The plan preserves the
  raw measure and unit, distinguishes zero from null, and blocks unsupported
  metrics with a reason. No Measures or Flex writes are proposed.
- Date-only evidence with a source zone can receive a one-hour proposed
  calendar allocation starting at 08:00 local, in stable date, subject-name
  and source-key order. The allocator checks the supplied coach occupancy,
  trustworthy source intervals and preceding selected allocations. Skipped or
  repeated local clock edges do not define a slot. The hour is an allocation
  window and is recorded separately from original timing. MIG-04 has no
  reliable scheduled end or duration. Every standalone appointment therefore
  has `endsAtUtc: null` and `missed: 'undetermined'`, with
  `UNKNOWN_SCHEDULE_END`. A future source-contract extension would need
  explicit end evidence before classifying a workout as missed.

## Wire contract and readiness

`kind` is `mezfit.import-plan`, `schemaVersion` is `1`, and policy is
`mig-05.v1`. The plan includes original source provenance and package
digest, period and evaluation instant, snapshot digests, typed bindings,
mappings, operations, selections, issues, omissions and preview counts.

| Operation | Payload and dependencies |
| --- | --- |
| `program_structure` | Ordered skeleton, activation proposal, exercise mapping keys and required custom-exercise groups. |
| `historical_session` | Original occurrence and program evidence, lifecycle, timing, frozen PLAN and separate FACT. Depends on referenced program and custom exercises where applicable. |
| `standalone_scheduled` | Timing, original program/day evidence, PLAN and missed classification. Dependencies mirror the elements used by its PLAN. |
| `custom_exercise` | Proposed name and tracking type, stable mapping reference and deferred reconciliation marker. No storage ID. |
| `provenance_metadata` | Imported marker and dependency on the operation whose history it describes. This is a proposed metadata envelope. |

Selection statuses are `selected`, `excluded_by_coach`, `blocked`,
`outside_period`, `already_imported` and `represented_by_session`.
Dependencies are direct edges. Traverse them to compute the closure of a
selected group. A selected group requires every dependency to be selected
or represented by the existing imports snapshot. Unknown bindings,
unfinished sessions and incompatible metrics can be inspected as blocked
candidates. Resource limits, malformed shapes and impossible source graphs
fail at ingress with a stable error code. Runtime validation checks the exact
plan shape, references, dependency kinds, derived counts, conversion
consistency and the plan digest.

| Readiness | Meaning |
| --- | --- |
| `ready_for_review` | There are selected operations and no detected blocking groups or unresolved snapshot or scheduled-end decisions. |
| `requires_decisions` | Some groups can be reviewed while other groups or evidence still require a decision. |
| `blocked` | There are no selected groups. See selection statuses to distinguish problems from a range without eligible data or an already imported range. |

Only the private preview may display source names, identifiers and values.
Runtime failures carry stable codes. Operational telemetry, if added later,
must use codes and counts without attaching the plan, values or identifiers.

### Identity and limits

The plan ID is lower-case SHA-256 of UTF-8 canonical JSON for the whole plan
with `planId` removed. Object keys are sorted by code-unit order. The package
digest canonicalizes source arrays independently of transport order, while
position fields preserve business order. Snapshot lists are canonicalized
independently of item order. A group key is SHA-256 of the ordered tuple
`[key version, source app, format family, dataset, target context, subject, entity type, source key]`.
Provenance operations use a separate namespace keyed to their parent. A new
archive checksum changes the plan identity while stable entity identities
can retain replay keys. Any identity change in the source namespace or
target context requires a new review.

The package retains the MIG-04 logical limits and has a 64 KiB ingress cap.
The config and output have independent 4 MiB and 8 MiB caps, 100,000 total
JSON values and a depth cap of 18. Exact collection caps apply per shape.
The catalogue accepts up to 10,000 entries and occupancy accepts up to 4,096
intervals. These are planning limits. The processor result schema and limits
remain owned by MIG-04.

## Complete example

The [independent fixture and assertions](../../migration/import-plan/import-plan.test.mjs)
hold the executable example with all wire fields. A coach selects
`2026-01-01` through `2026-12-31`, selection zone `Europe/Moscow`,
evaluated at `2027-01-02T10:00:00Z`. The subject has a provisional context
and the supplied occupancy and import registry are empty.

| Source | Proposal |
| --- | --- |
| Program from 2022, with two days in one phase | Include both days, even the day with no corresponding workout in the range. Preserve the 95 kg source template prescription in the loss report. The structural set retains type, label and comment. |
| Linked appointment on January 1 | `represented_by_session`, with no standalone operation. |
| Completed session on January 1 | Completed imported history. Frozen PLAN 82 kg × 10, FACT 100 lb × 8 → 45.359237 kg × 8. Both refer to the catalogued press through the central mapping. |
| Independent completed session on December 31 | Completed Ad-hoc, FACT 2 min → 120 s, with no program, occurrence or frozen PLAN. Uses the proposed custom hold, shared with the program’s second day. |
| Standalone appointment on December 31 | Separate calendar proposal with PLAN 77 kg × 10. `missed: undetermined` and `UNKNOWN_SCHEDULE_END`. |
| Unreferenced program from 2026 | No operation. |
| Three body measurements | `omittedData` records three unsupported Measures. |

The preview has two source sessions, two source calendar records, two source
programs, five selected operation groups, one represented appointment, one
linked program, one catalogue match, one proposed custom exercise and four
converted sets. The program and three workouts have provenance operations
linked to their groups. Readiness is `requires_decisions` because the
standalone appointment has no reliable end.

In the partial example, the same hold FACT has unit `beats` instead of
`min`. The independent session is blocked with `UNSUPPORTED_UNIT`, and its
raw measure stays visible in the plan with a null conversion. The linked
session and program are still selected. The custom hold is still needed by
the selected program. The three omitted body measurements and original
program prescription remain in the loss report.

## Integration boundary

MIG-05 does not implement an adapter for a real format, UI, an Import
Publisher, imported-client storage, Dexie access, Flex projection, exercise
reconciliation, or Clone & Rebind. In the current runtime, existing Ad-hoc
execution and frozen occurrence PLAN have their own storage invariants.
This plan cannot manufacture missing storage references, calendar durations
or actor/realm identities. Those decisions belong to a later reviewed
materialization and authorization contract.
