import { liveQuery } from 'dexie';
import { isFitnessProgramerExerciseId, isFitnessProgramerGifId } from '../../../shared/fitnessprogramer-id';
import type { MezfitCloudDatabase } from '../cloud/database';
import { EQUIPMENT_LABELS } from './publicExerciseFilters';
import { isExerciseTrackingType, type ExerciseTrackingType, type PublicExerciseRow } from './publicExerciseTypes';

const MANIFEST_ID = 'fitnessprogramer:v1';
const RELEASE = '425a328643112b3b0b5371f42bf1504d763137433dd816dbe13c050e3f6ebe21';
const EXERCISE_COUNT = 1173;
const GIF_COUNT = 1167;

export const FITNESSPROGRAMER_DEFINITION_TABLES = ['publicFitnessProgramerExercises', 'publicFitnessProgramerCatalogues'] as const;
const GIF_TABLE = 'publicFitnessProgramerGifs';

interface FitnessProgramerCard {
  name: string;
  name_ru: string;
  source_url: string;
  tracking_type: ExerciseTrackingType;
  equipment: string[];
  muscle_group: string[];
  how_to: string;
  how_to_ru?: string;
  muscles: {
    target: string[];
    synergists?: string[];
    stabilizers?: { dynamic?: string[]; antagonist?: string[] };
  };
}
export interface FitnessProgramerExerciseRow {
  id: string;
  realmId: 'rlm-public';
  owner: null;
  release: string;
  card: FitnessProgramerCard;
  categories: string[];
  gifId: string | null;
}
export interface FitnessProgramerCatalogueRow {
  id: typeof MANIFEST_ID;
  realmId: 'rlm-public';
  owner: null;
  release: string;
  exerciseCount: number;
  gifCount: number;
}
export interface FitnessProgramerGifRow {
  id: string;
  realmId: 'rlm-public';
  owner: null;
  release: string;
  digest: string;
  size: number;
  image: unknown;
}
export type FitnessProgramerExercise = PublicExerciseRow & {
  categories: string[];
  equipmentOptions: string[];
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const strings = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every(item => typeof item === 'string');
const isPublicRelease = (value: unknown): value is Record<string, unknown> =>
  isRecord(value) && value.realmId === 'rlm-public' && value.owner === null && value.release === RELEASE;

function isManifest(value: unknown): value is FitnessProgramerCatalogueRow {
  return isPublicRelease(value) && value.id === MANIFEST_ID
    && value.exerciseCount === EXERCISE_COUNT && value.gifCount === GIF_COUNT;
}

function isExercise(value: unknown): value is FitnessProgramerExerciseRow {
  if (!isPublicRelease(value) || typeof value.id !== 'string'
    || !isFitnessProgramerExerciseId(value.id) || !strings(value.categories)
    || (value.gifId !== null && !isFitnessProgramerGifId(value.gifId)) || !isRecord(value.card)) return false;
  const card = value.card;
  return typeof card.name === 'string' && typeof card.name_ru === 'string' && !!card.name_ru.trim()
    && card.source_url === 'https://fitnessprogramer.com/exercise/' + value.id.slice('fitnessprogramer:'.length) + '/'
    && isExerciseTrackingType(card.tracking_type) && strings(card.equipment) && strings(card.muscle_group)
    && typeof card.how_to === 'string' && (card.how_to_ru === undefined || typeof card.how_to_ru === 'string')
    && isRecord(card.muscles) && strings(card.muscles.target)
    && (card.muscles.synergists === undefined || strings(card.muscles.synergists))
    && (card.muscles.stabilizers === undefined || (isRecord(card.muscles.stabilizers)
      && (card.muscles.stabilizers.dynamic === undefined || strings(card.muscles.stabilizers.dynamic))
      && (card.muscles.stabilizers.antagonist === undefined || strings(card.muscles.stabilizers.antagonist))));
}

const categoryIds: Readonly<Record<string, string>> = {
  chest: 'chest', biceps: 'arms', triceps: 'arms', forearm: 'arms', back: 'back',
  trapezius: 'back', 'erector-spinae': 'back', shoulders: 'shoulders', abs: 'core',
  hip: 'legs', leg: 'legs', calf: 'legs', 'full-body': 'full_body', cardio: 'cardio', neck: 'other',
};
const muscleAliases: Readonly<Record<string, string>> = {
  'pectoralis major, sternal': 'pectoralis_sternal',
  'pectoralis major, clavicular': 'pectoralis_clavicular',
  'anterior deltoid': 'deltoid_anterior', 'lateral deltoid': 'deltoid_lateral',
  'posterior deltoid': 'deltoid_posterior', quadriceps: 'quadriceps_femoris',
  triceps: 'triceps_brachii', biceps: 'biceps_brachii',
  'lower trapezius': 'trapezius_lower', 'upper trapezius': 'trapezius_upper',
  'middle trapezius': 'trapezius_middle', 'wrist flexors': 'forearm_flexors',
  'wrist extensors': 'forearm_extensors', adductors: 'hip_adductors',
  'hip adductors': 'hip_adductors', deltoids: 'deltoideus',
};
const equipmentAliases: Readonly<Record<string, string>> = { 'trx suspension': 'trx' };
const unique = (values: string[]) => [...new Set(values)];
const muscleIds = (names: string[]) => unique(names.map(name => {
  const normalized = name.trim().toLowerCase();
  return muscleAliases[normalized] ?? normalized.replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}).filter(Boolean));

export function projectFitnessProgramerExercise(row: FitnessProgramerExerciseRow): FitnessProgramerExercise {
  const { card } = row;
  const categories = unique(row.categories.map(item => categoryIds[item] ?? 'other'));
  const category = categories.find(item => item !== 'other') ?? 'other';
  if (!categories.length) categories.push(category);
  const equipmentOptions = unique(card.equipment.map(item => item.trim().toLowerCase())
    .filter(item => item !== 'full gym').map(item => equipmentAliases[item] ?? item)
    .filter(item => Object.hasOwn(EQUIPMENT_LABELS, item)));
  const primary = muscleIds(card.muscles.target);
  const secondary = muscleIds(card.muscles.synergists ?? []);
  return {
    id: row.id, realmId: row.realmId, owner: row.owner, sourceSha256: row.release,
    name: card.name_ru, name_ru: card.name_ru, name_en: card.name, category, categories,
    subcategory: '', subcategory_ru: '', movement_type: categories.includes('cardio') ? 'cardio' : '',
    tracking_type: card.tracking_type, equipment: equipmentOptions[0] ?? '', equipmentOptions,
    body_part: '', target: card.muscles.target.join(', '), muscle_group: card.muscle_group.join(', '),
    secondary_muscles: card.muscles.synergists ?? [], mobility_targets: [],
    muscles: { primary, secondary, stabilizers: muscleIds(card.muscles.stabilizers?.dynamic ?? []), emphasis: [] },
    media_id: row.gifId ?? '', image: '', gif_url: '', attribution: 'FitnessProgramer', created_at: '',
    instructions: { ru: card.how_to_ru ?? '', en: card.how_to },
    instruction_steps: { ru: [], en: [] }, source_consistency_issue: null,
    anatomy_evidence: { classification_family: 'FitnessProgramer', basis: card.source_url, external_individual_match: false },
  };
}

export function fitnessProgramerMediaReference(id: unknown): string | null {
  return isFitnessProgramerGifId(id) ? 'dexie-gif:' + id : null;
}

export function fitnessProgramerGifFromReference(reference: string | null | undefined): string | null {
  const id = reference?.startsWith('dexie-gif:') ? reference.slice('dexie-gif:'.length) : null;
  return isFitnessProgramerGifId(id) ? id : null;
}

function resolvedFitnessProgramerGif(row: unknown, id: string): Blob | null {
  if (!isPublicRelease(row) || row.id !== id || row.digest !== id.slice('fitnessprogramer:gif:'.length)
    || !(row.image instanceof Blob) || row.image.type !== 'image/gif'
    || row.image.size !== row.size || row.image.size < 16 || row.image.size > 2 * 1024 * 1024) return null;
  return row.image;
}

export class FitnessProgramerCatalogueRepository {
  constructor(private readonly db: MezfitCloudDatabase) {}

  async get(id: string): Promise<FitnessProgramerExercise | null> {
    if (!isFitnessProgramerExerciseId(id) || !this.db.publicFitnessProgramerExercises) return null;
    const [row, manifest] = await Promise.all([
      this.db.publicFitnessProgramerExercises.get(id), this.db.publicFitnessProgramerCatalogues.get(MANIFEST_ID),
    ]);
    return isManifest(manifest) && isExercise(row) ? projectFitnessProgramerExercise(row) : null;
  }

  observe(next: (exercises: FitnessProgramerExercise[] | null) => void, error: (cause: unknown) => void) {
    return liveQuery(() => this.db.transaction('r', [...FITNESSPROGRAMER_DEFINITION_TABLES], async () => {
      const manifest = await this.db.publicFitnessProgramerCatalogues.get(MANIFEST_ID);
      if (!isManifest(manifest)) return null;
      const rows = await this.db.publicFitnessProgramerExercises.toArray();
      if (rows.length !== manifest.exerciseCount || !rows.every(isExercise)
        || new Set(rows.flatMap(row => row.gifId ? [row.gifId] : [])).size !== manifest.gifCount) return null;
      return rows.map(projectFitnessProgramerExercise);
    })).subscribe({ next, error });
  }

  // Reads the Addon's persisted bytes without triggering lazy downloads from the UI.
  readLocalGif(id: string): Promise<Blob | null> {
    if (!isFitnessProgramerGifId(id)) return Promise.resolve(null);
    return new Promise((resolve, reject) => {
      const request = this.db.backendDB().transaction(GIF_TABLE, 'readonly').objectStore(GIF_TABLE).get(id);
      request.onsuccess = () => resolve(resolvedFitnessProgramerGif(request.result, id));
      request.onerror = () => reject(request.error);
    });
  }

  /** Keys only. The Addon resolves and persists binary data separately after sync. */
  async availableGifIds(): Promise<Set<string>> {
    const table = this.db.publicFitnessProgramerGifs;
    const [all, pending] = await this.db.transaction('r', table, () => Promise.all([
      table.toCollection().primaryKeys(), table.where('_hasBlobRefs').equals(1).primaryKeys(),
    ]));
    const missing = new Set(pending);
    return new Set(all.filter(id => isFitnessProgramerGifId(id) && !missing.has(id)));
  }
}
