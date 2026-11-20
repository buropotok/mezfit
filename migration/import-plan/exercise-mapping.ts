import type { SourceExercise } from '../worker/processor/source-package/types';
import type { CatalogueEntry, ExerciseMapping, IssueCode, Tracking } from './contracts';

const normalized = (value: string) => value.normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase();
function fingerprint(name: string, type: Tracking, equipment: string, movement: string): string {
  return JSON.stringify([normalized(name), type, normalized(equipment), normalized(movement)]);
}

export function exerciseMatcher(catalogue: CatalogueEntry[] | null, approved: Map<string, string> | null) {
  const byId = new Map(catalogue?.map(entry => [entry.id, entry]));
  const byFingerprint = new Map<string, CatalogueEntry[]>();
  for (const entry of catalogue ?? []) {
    if (!entry.equipment || !entry.movementType) continue;
    const key = fingerprint(entry.name, entry.trackingType, entry.equipment, entry.movementType);
    const candidates = byFingerprint.get(key) ?? [];
    candidates.push(entry);
    byFingerprint.set(key, candidates);
  }
  return (fields: Pick<ExerciseMapping, 'mappingKey' | 'subjectKey' | 'exerciseSourceKey'>,
    source: SourceExercise | undefined, report: (code: IssueCode) => void): ExerciseMapping => {
    const unresolved = (reason: IssueCode): ExerciseMapping => ({ ...fields, kind: 'unresolved', reason });
    if (!source) return unresolved('UNRESOLVED_SOURCE_LINK');
    if (catalogue === null || approved === null) return unresolved('CATALOGUE_UNRESOLVED');
    const approvedId = approved.get(fields.mappingKey);
    if (approvedId) {
      const target = byId.get(approvedId);
      return target && (!source.trackingHint || source.trackingHint === target.trackingType)
        ? { ...fields, kind: 'catalogue', target, evidence: 'approved_registry' }
        : unresolved('INVALID_APPROVED_MAPPING');
    }
    const name = source.sourceName?.trim();
    const type = source.trackingHint;
    if (name && type && source.equipment?.trim() && source.movementType?.trim()) {
      const candidates = byFingerprint.get(fingerprint(name, type, source.equipment, source.movementType)) ?? [];
      if (candidates.length === 1) return { ...fields, kind: 'catalogue', target: candidates[0], evidence: 'exact_fingerprint' };
      if (candidates.length > 1) report('CATALOGUE_AMBIGUOUS');
    }
    if (!name || name.length > 120 || type === null) return unresolved('CUSTOM_EXERCISE_DATA_MISSING');
    return { ...fields, kind: 'proposed_custom',
      definition: { name, trackingType: type, requiresPostImportReconciliation: true } };
  };
}
