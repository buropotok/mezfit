// Independent static audit of the staged exercise catalogue.
// Uses only Node built-ins. Does not import or mutate app data.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const path = resolve(root, 'data/exercise-anatomy-v1.json');
const data = JSON.parse(readFileSync(path, 'utf8'));
const errors = [];
const check = (ok, message) => { if (!ok) errors.push(message); };
const validCategories = new Set(['chest', 'arms', 'back', 'legs', 'shoulders', 'core', 'full_body', 'cardio', 'other']);
const validKinds = new Set(['strength', 'mobility', 'conditioning', 'skill']);
const validNames = new Set(['curated_rule', 'rule_candidate', 'rule_draft', 'legacy_draft']);
const taxonomy = data.taxonomy ?? {};
const muscleIds = new Set(Object.keys(taxonomy));
const ids = new Set();

check(data.schema_version === '1.0.0', 'Unexpected schema version');
check(data.status === 'audit_draft_not_for_production_import', 'Draft production guard removed');
check(Array.isArray(data.exercises) && data.exercises.length === 1324, 'Expected 1324 records');

for (const [id, node] of Object.entries(taxonomy)) {
  check(typeof node.label_ru === 'string' && node.label_ru.length > 0, `Unlabeled taxonomy node: ${id}`);
  check(validCategories.has(node.category), `Invalid taxonomy category: ${id}`);
  if (node.parent) check(muscleIds.has(node.parent) && node.parent !== id, `Invalid taxonomy parent: ${id}`);
  const seen = new Set([id]);
  let next = node.parent;
  while (next) {
    if (seen.has(next)) { errors.push(`Taxonomy parent cycle: ${id}`); break; }
    seen.add(next);
    next = taxonomy[next]?.parent;
  }
}

for (const exercise of data.exercises ?? []) {
  const id = exercise.source_id;
  check(/^\d{4}$/.test(id), `Invalid source ID: ${id}`);
  check(!ids.has(id), `Duplicate source ID: ${id}`);
  ids.add(id);
  check(typeof exercise.name_en === 'string' && exercise.name_en.trim().length > 0, `Missing English name: ${id}`);
  check(typeof exercise.name_ru === 'string' && /[А-Яа-яЁё]/.test(exercise.name_ru), `Missing Russian draft: ${id}`);
  check(validNames.has(exercise.name_status), `Invalid name status: ${id}`);
  check(validCategories.has(exercise.category), `Invalid category: ${id}`);
  check(validKinds.has(exercise.exercise_kind), `Invalid movement kind: ${id}`);
  check(exercise.review?.status === 'needs_expert_review', `Unexpectedly approved without expert review: ${id}`);
  check(exercise.review?.external_match === 'unverified', `Unexpected external verification claim: ${id}`);
  check(typeof exercise.source_evidence?.instructions_en === 'string' && exercise.source_evidence.instructions_en.length > 0, `Missing source instructions: ${id}`);
  check(Object.prototype.hasOwnProperty.call(taxonomy, exercise.subcategory) , `Invalid subcategory: ${id}`);
  const roleSets = ['primary', 'secondary', 'stabilizers'].map(role => ({
    role,
    ids: exercise.muscles?.[role]
  }));
  for (const role of roleSets) {
    check(Array.isArray(role.ids), `Missing ${role.role}: ${id}`);
    if (!Array.isArray(role.ids)) continue;
    check(new Set(role.ids).size === role.ids.length, `Duplicate muscle in ${role.role}: ${id}`);
    for (const muscle of role.ids) check(muscleIds.has(muscle), `Unknown muscle ${muscle} in ${id}`);
  }
  const seenRoles = new Set();
  for (const role of roleSets) for (const muscle of role.ids ?? []) {
    check(!seenRoles.has(muscle), `Same muscle assigned to multiple roles: ${id} ${muscle}`);
    seenRoles.add(muscle);
  }
  for (const muscle of exercise.regional_emphasis ?? []) {
    check(muscleIds.has(muscle), `Unknown region ${muscle} in ${id}`);
    check(['zone', 'region', 'muscle', 'group'].includes(taxonomy[muscle]?.kind), `Invalid region ${muscle} in ${id}`);
  }
  for (const [parent, details] of Object.entries(exercise.anatomical_parts ?? {})) {
    check(muscleIds.has(parent), `Unknown anatomical parent: ${id} ${parent}`);
    check(['primary', 'secondary', 'stabilizers'].includes(details.role), `Unknown role in anatomical parts: ${id}`);
    check((exercise.muscles?.[details.role] ?? []).includes(parent), `Anatomical parent missing from declared role: ${id} ${parent}`);
    check(Array.isArray(details.members) && details.members.length > 0, `Missing anatomical members: ${id} ${parent}`);
    for (const child of details.members ?? []) {
      check(muscleIds.has(child), `Unknown anatomical child: ${id} ${child}`);
      check(taxonomy[child]?.parent === parent, `Anatomical child is not a direct member: ${id} ${child}`);
    }
  }
  if (exercise.exercise_kind === 'conditioning') check(exercise.muscles.primary.length === 0, `Cardio has invented primary muscle: ${id}`);
}

check(ids.size === 1324, `Unique exercise IDs: ${ids.size}/1324`);
if (errors.length) {
  console.error(errors.slice(0, 60).join('\n'));
  console.error(`Exercise anatomy validation failed: ${errors.length} errors`);
  process.exitCode = 1;
} else {
  const counts = Object.groupBy
    ? Object.groupBy(data.exercises, exercise => exercise.name_status)
    : Object.fromEntries([...validNames].map(status => [status, data.exercises.filter(ex => ex.name_status === status)]));
  console.log('Schema/coverage/reference integrity validated (not anatomical correctness).');
  console.log(`Exercises: ${ids.size}; taxonomy items: ${muscleIds.size}`);
  for (const [name, list] of Object.entries(counts)) console.log(`${name}: ${list.length}`);
}
