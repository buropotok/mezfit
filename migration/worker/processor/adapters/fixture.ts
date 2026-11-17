import { FIXTURE_FORMAT, PROCESSOR_INPUT_LIMIT, PROCESSOR_RECORD_LIMIT } from '../../../processor-protocol.mjs';
import { exactKeys, jsonMarker, ProcessingFailure, record, type AdapterInput, type ImportAdapter } from '../contracts';

export const fixtureAdapter: ImportAdapter = Object.freeze({
  descriptor: Object.freeze({
    adapterId: 'synthetic-fixture', adapterVersion: '1.0.0', format: FIXTURE_FORMAT,
    formatFamily: 'mezfit-migration-fixture', registration: 'reviewed', detection: 'bounded-json-marker',
    maxInputBytes: PROCESSOR_INPUT_LIMIT, maxRecords: PROCESSOR_RECORD_LIMIT, resultSchemaVersion: 1,
  }),
  detect: (input: AdapterInput) => jsonMarker(input.json, FIXTURE_FORMAT, 'mezfit-migration-fixture'),
  parse(source: AdapterInput) {
    const input = source.json;
    if (!record(input) || input.format !== FIXTURE_FORMAT || !exactKeys(input, ['format', 'records'])
      || !Array.isArray(input.records) || input.records.length > PROCESSOR_RECORD_LIMIT
      || !input.records.every(item => record(item) && exactKeys(item, ['value'])
        && typeof item.value === 'number' && Number.isSafeInteger(item.value))) {
      throw new ProcessingFailure('INVALID_INPUT_SCHEMA');
    }
    return { recordsValidated: input.records.length, warnings: [], normalized: null };
  },
  validate(data: unknown): data is { recordsValidated: number; warnings: string[]; normalized: null } {
    return record(data) && exactKeys(data, ['recordsValidated', 'warnings', 'normalized'])
      && typeof data.recordsValidated === 'number' && Number.isSafeInteger(data.recordsValidated)
      && data.recordsValidated >= 0 && data.recordsValidated <= PROCESSOR_RECORD_LIMIT
      && Array.isArray(data.warnings) && data.warnings.length === 0 && data.normalized === null;
  },
});
