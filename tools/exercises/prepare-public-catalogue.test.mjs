import { describe, expect, it } from 'vitest';
import { diffExerciseRecords } from './prepare-public-catalogue.mjs';

describe('public exercise catalogue import diff', () => {
  it('is idempotent when records have the same fields in a different key order', () => {
    const existing = {
      '0001': { id: '0001', realmId: 'rlm-public', owner: null, name: 'Жим' },
    };
    const next = {
      '0001': { name: 'Жим', owner: null, realmId: 'rlm-public', id: '0001' },
    };
    expect(diffExerciseRecords(existing, next)).toEqual({
      added: [], changed: [], unchanged: ['0001'], missing: [],
    });
  });

  it('reports missing existing records without deleting or changing them', () => {
    const existing = {
      '0001': { id: '0001', name: 'Прежнее название' },
      '0002': { id: '0002', name: 'Старая запись без исходника' },
    };
    const next = {
      '0001': { id: '0001', name: 'Новое название' },
      '0003': { id: '0003', name: 'Новое упражнение' },
    };
    expect(diffExerciseRecords(existing, next)).toEqual({
      added: ['0003'], changed: ['0001'], unchanged: [], missing: ['0002'],
    });
    expect(existing['0002']).toEqual({ id: '0002', name: 'Старая запись без исходника' });
  });
});
