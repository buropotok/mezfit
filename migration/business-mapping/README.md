# MIG-05 Business Mapping Engine

Pure, deterministic **dry-run** mapping from a reviewed MIG-04 `SourceImportPackageV1` to `MezfitImportPlanV1`.

```ts
import { buildMezfitImportPlan, isMezfitImportPlan } from './business-mapping';
const plan = await buildMezfitImportPlan({
  sourcePackage, // must pass MIG-04 isSourceImportPackage
  period: { fromDate: '2026-01-01', throughDate: '2026-12-31', selectionTimeZone: 'Europe/Warsaw' },
  evaluatedAtUtc: '2026-11-20T10:00:00.000Z',
  policyVersion: 'MIG-05/v1',
  targetContextSnapshot, catalogueSnapshot, mappingSnapshot,
  calendarOccupancySnapshot, existingImportsSnapshot,
  selectionSnapshot: { exclusions: [] },
});
if (!isMezfitImportPlan(plan)) throw new Error('INVALID_PLAN');
```

All snapshots are external, read-only, validated and included in identity hashes. An explicit `datasetKey` namespaces source identities across export datasets. `selectionSnapshot` describes the current preview-only exclusions and is **not** coach approval. Future caller must resolve a relative period *before* invoking the engine and freeze `evaluatedAtUtc`; the engine never reads current time.

The output contains **proposed**, not persisted, programs, sessions, scheduled workouts, custom exercises and provenance. `ready_for_review` does NOT authorize publication. Source coverage, incomplete sessions, plan/fact conversion errors, orphan dependencies and unresolved scheduling dates are reported. The current SourcePackage v1 has no proven scheduled duration/end; standalone scheduled candidates consequently remain blocked with `SCHEDULE_END_UNKNOWN` until evidence/contract is extended. No source-completion time is used as scheduled end. Imported custom exercises require subsequent human reconciliation after publication by a future service.

See [normative plan contract](../../docs/architecture/migration-import-plan-contract.md).
`plan.test.mjs` contains independent fixture and contract tests. The branch deliberately does not modify MIG-04 processor, D1 jobs, workflow or Dexie code; GitHub Actions will run validation on PR.
