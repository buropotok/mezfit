import { PROCESSOR_INPUT_LIMIT } from '../../../processor-protocol.mjs';
import { exactKeys, jsonMarker, ProcessingFailure, record, type AdapterData, type AdapterInput, type ImportAdapter } from '../contracts';

export const NESTED_FORMAT = 'mezfit-migration-nested-v1';
export const NESTED_RECORD_LIMIT = 8;
type Group = { id: string };
type Item = { id: string; group: string; value: number; ref: string | null };
const sourceId = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{1,32}$/.test(value);
const integer = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value);
const order = (a: { id: string }, b: { id: string }) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

function validateLinks(groups: readonly Group[], items: readonly Item[]) {
  const ids = [...groups, ...items].map(entity => entity.id);
  if (new Set(ids).size !== ids.length) throw new ProcessingFailure('DUPLICATE_SOURCE_ID');
  const groupIds = new Set(groups.map(group => group.id));
  const itemIds = new Set(items.map(item => item.id));
  if (items.some(item => !groupIds.has(item.group) || item.ref !== null && !itemIds.has(item.ref))) {
    throw new ProcessingFailure('DANGLING_REFERENCE');
  }
}

function parse(input: unknown): AdapterData {
  if (!record(input) || !exactKeys(input, ['format', 'container']) || input.format !== NESTED_FORMAT
    || !record(input.container) || !exactKeys(input.container, ['groups']) || !Array.isArray(input.container.groups)) {
    throw new ProcessingFailure('INVALID_INPUT_SCHEMA');
  }
  if (input.container.groups.length > NESTED_RECORD_LIMIT) throw new ProcessingFailure('ADAPTER_RECORD_LIMIT');
  const groups: Group[] = [];
  const items: Item[] = [];
  for (const group of input.container.groups) {
    if (!record(group) || !exactKeys(group, ['sourceId', 'items']) || !sourceId(group.sourceId) || !Array.isArray(group.items)) {
      throw new ProcessingFailure('INVALID_INPUT_SCHEMA');
    }
    groups.push({ id: group.sourceId });
    for (const item of group.items) {
      if (!record(item) || !exactKeys(item, ['sourceId', 'amount', 'peerId']) || !sourceId(item.sourceId)
        || !integer(item.amount) || item.peerId !== null && !sourceId(item.peerId)) {
        throw new ProcessingFailure('INVALID_INPUT_SCHEMA');
      }
      items.push({ id: item.sourceId, group: group.sourceId, value: item.amount, ref: item.peerId });
      if (items.length > NESTED_RECORD_LIMIT) throw new ProcessingFailure('ADAPTER_RECORD_LIMIT');
    }
  }
  validateLinks(groups, items);
  const emptyGroup = groups.some(group => !items.some(item => item.group === group.id));
  return { recordsValidated: items.length, warnings: emptyGroup ? ['EMPTY_GROUP'] : [],
    normalized: { groups: groups.sort(order), items: items.sort(order) } };
}

function isGroup(value: unknown): value is Group {
  return record(value) && exactKeys(value, ['id']) && sourceId(value.id);
}

function isItem(value: unknown): value is Item {
  return record(value) && exactKeys(value, ['id', 'group', 'value', 'ref'])
    && sourceId(value.id) && sourceId(value.group) && integer(value.value) && (value.ref === null || sourceId(value.ref));
}

function validate(data: unknown): data is AdapterData {
  if (!record(data) || !exactKeys(data, ['recordsValidated', 'warnings', 'normalized'])
    || !integer(data.recordsValidated) || !Array.isArray(data.warnings) || !record(data.normalized)
    || !exactKeys(data.normalized, ['groups', 'items'])) return false;
  const { groups, items } = data.normalized;
  if (!Array.isArray(groups) || !Array.isArray(items) || groups.length > NESTED_RECORD_LIMIT
    || items.length > NESTED_RECORD_LIMIT || data.recordsValidated !== items.length
    || !groups.every(isGroup) || !items.every(isItem)) return false;
  try { validateLinks(groups, items); }
  catch { return false; }
  if (!groups.every((group, i) => i === 0 || order(groups[i - 1], group) < 0)
    || !items.every((item, i) => i === 0 || order(items[i - 1], item) < 0)) return false;
  const emptyGroup = groups.some(group => !items.some(item => item.group === group.id));
  return emptyGroup ? data.warnings.length === 1 && data.warnings[0] === 'EMPTY_GROUP' : data.warnings.length === 0;
}

export const nestedAdapter: ImportAdapter = Object.freeze({
  descriptor: Object.freeze({
    adapterId: 'synthetic-nested', adapterVersion: '1.0.0', format: NESTED_FORMAT,
    formatFamily: 'mezfit-migration-nested', registration: 'reviewed', detection: 'bounded-json-marker',
    maxInputBytes: PROCESSOR_INPUT_LIMIT, maxRecords: NESTED_RECORD_LIMIT, resultSchemaVersion: 2,
  }),
  detect: (input: AdapterInput) => jsonMarker(input.json, NESTED_FORMAT, 'mezfit-migration-nested'),
  parse: (input: AdapterInput) => parse(input.json), validate,
});
