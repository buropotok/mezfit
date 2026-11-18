import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { describe, expect, it } from 'vitest';
import { CLOUD_DATABASE_STORES_V17, CLOUD_DATABASE_STORES_V18, type MezfitCloudDatabase } from '../cloud/database';
import { programExerciseSnapshot, readProgramCatalogueExercise } from '../cloud/program-exercise-selection';
import {
  FitnessProgramerCatalogueRepository, fitnessProgramerGifFromReference, projectFitnessProgramerExercise,
  type FitnessProgramerExerciseRow,
} from './fitnessProgramerCatalogue';
import { filterPublicExercises } from './publicExerciseFilters';

const release = '425a328643112b3b0b5371f42bf1504d763137433dd816dbe13c050e3f6ebe21';
const digest = 'a'.repeat(64);
const gifId = 'fitnessprogramer:gif:' + digest;
const row: FitnessProgramerExerciseRow = {
  id: 'fitnessprogramer:bench-press', realmId: 'rlm-public', owner: null, release,
  categories: ['chest', 'triceps'], gifId,
  card: { name: 'Bench Press', name_ru: 'Жим лёжа', source_url: 'https://fitnessprogramer.com/exercise/bench-press/',
    tracking_type: 'weight_reps', equipment: ['Full Gym', 'Barbell', 'Bench'], muscle_group: ['Chest'],
    how_to: 'Press the bar.', muscles: { target: ['Pectoralis Major, Sternal'], synergists: ['Triceps'] } },
};

// Plain Dexie fixtures use physical IndexedDB keys. The Cloud Addon strips @ in the app.
const indexedDbStores = (stores: typeof CLOUD_DATABASE_STORES_V17) =>
  Object.fromEntries(Object.entries(stores).map(([name, schema]) => [name, schema?.replace(/^@/, '') ?? null]));

describe('FitnessProgramer client catalogue', () => {
  it('preserves category and equipment choices and resolves the stable media reference', () => {
    const exercise = projectFitnessProgramerExercise(row);
    expect(exercise).toMatchObject({ category: 'chest', categories: ['chest', 'arms'],
      equipmentOptions: ['barbell', 'bench'], instructions: { ru: '', en: 'Press the bar.' },
      muscles: { primary: ['pectoralis_sternal'], secondary: ['triceps_brachii'] } });
    expect(filterPublicExercises([exercise], [], { equipment: ['bench'] }, 'Жим', 'arms')).toEqual([exercise]);
    expect(filterPublicExercises([exercise], [], { category: ['arms'] }, 'Bench Press')).toEqual([exercise]);
    const snapshot = programExerciseSnapshot(exercise, 'tg:1');
    expect(snapshot).toMatchObject({ scope: 'public', exerciseDefinitionId: row.id });
    expect(fitnessProgramerGifFromReference(snapshot.mediaUrl)).toBe(gifId);
  });

  it('adds Base 2 without replacing existing stores and reads only persisted GIF bytes', async () => {
    const name = 'fitnessprogramer-' + crypto.randomUUID();
    const previous = new Dexie(name);
    previous.version(17).stores(indexedDbStores(CLOUD_DATABASE_STORES_V17));
    const existing = await previous.table('trainingPlans').add({ id: 'existing', name: 'Existing' });
    previous.close();
    const database = new Dexie(name);
    database.version(17).stores(indexedDbStores(CLOUD_DATABASE_STORES_V17));
    database.version(18).stores({ ...indexedDbStores(CLOUD_DATABASE_STORES_V18), publicFitnessProgramerGifs: 'id,_hasBlobRefs' });
    await database.open();
    try {
      expect((await database.table('trainingPlans').get(existing)).name).toBe('Existing');
      const db = database as unknown as MezfitCloudDatabase;
      const repository = new FitnessProgramerCatalogueRepository(db);
      await db.publicFitnessProgramerExercises.add(row);
      await expect(readProgramCatalogueExercise(db, 'tg:1', row.id)).rejects.toThrow('Упражнение недоступно');
      await db.publicFitnessProgramerCatalogues.add({
        id: 'fitnessprogramer:v1', realmId: 'rlm-public', owner: null, release, exerciseCount: 1173, gifCount: 1167,
      });
      expect((await readProgramCatalogueExercise(db, 'tg:1', row.id)).tracking_type).toBe('weight_reps');

      const gif = { id: gifId, realmId: 'rlm-public' as const, owner: null, release, digest, size: 16 };
      const pending = { ...gif, image: { ref: '1:pending' }, _hasBlobRefs: 1 };
      await db.publicFitnessProgramerGifs.put(pending);
      expect(await repository.availableGifIds()).toEqual(new Set());
      expect(await repository.readLocalGif(gifId)).toBeNull();
      await db.publicFitnessProgramerGifs.put({ ...gif, image: new Blob([new Uint8Array(16)], { type: 'image/gif' }) });
      expect(await repository.availableGifIds()).toEqual(new Set([gifId]));
      expect((await repository.readLocalGif(gifId))?.size).toBe(16);
    } finally {
      database.close();
      await database.delete();
    }
  });
});
