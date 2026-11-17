import { createHash } from 'node:crypto';
import { File } from 'node:buffer';
import { describe, expect, it, vi } from 'vitest';
import { FIXTURE_FORMAT, PROCESSOR_INPUT_LIMIT, PROCESSOR_RECORD_LIMIT, PROCESSOR_RESULT_LIMIT } from '../../processor-protocol.mjs';
import { traceWriter } from '../../trace.mjs';
import { adapterDescriptors, createProcessor, isResult, processFile } from './index';
import { fixtureAdapter } from './adapters/fixture';
import { nestedAdapter, NESTED_FORMAT, NESTED_RECORD_LIMIT } from './adapters/nested';

const encode = value => new TextEncoder().encode(typeof value === 'string' ? value : JSON.stringify(value)).buffer;
const nested = groups => ({ format: NESTED_FORMAT, container: { groups } });
const group = (sourceId, items = []) => ({ sourceId, items });
const item = (sourceId, amount = 0, peerId = null) => ({ sourceId, amount, peerId });
const fixture = records => ({ format: FIXTURE_FORMAT, records });
const process = input => processFile(encode(input), vi.fn());
const clone = value => JSON.parse(JSON.stringify(value));

describe('registered migration adapters', () => {
  it.each([0, 1, 3, PROCESSOR_RECORD_LIMIT])('retains fixture-v1 semantics for %i independent values', async count => {
    const input = fixture(Array.from({ length: count }, (_, n) => ({ value: n * -13 })));
    const bytes = encode(input);
    const result = await processFile(bytes, vi.fn());
    expect(result).toMatchObject({ schemaVersion: 1, detectedFormat: FIXTURE_FORMAT,
      summary: { recordsValidated: count, warningsCount: 0 }, warnings: [],
      inputSha256: createHash('sha256').update(new Uint8Array(bytes)).digest('hex') });
    expect(Object.keys(result)).toHaveLength(8);
    expect(JSON.stringify(result)).toBe(JSON.stringify({
      status: 'succeeded', schemaVersion: 1, processorVersion: 'v1', detectedFormat: FIXTURE_FORMAT,
      inputSizeBytes: bytes.byteLength, inputSha256: result.inputSha256,
      summary: { recordsValidated: count, warningsCount: 0 }, warnings: [],
    }));
    expect(isResult(result)).toBe(true);
    expect(await process(input)).toEqual(result);
  });

  it.each([0, 1, 4, NESTED_RECORD_LIMIT])('normalizes %i nested items through the common processor and result validator', async count => {
    const result = await process(nested([group('g', Array.from({ length: count }, (_, n) => item('i' + n, 10 - n)))]));
    expect(result).toMatchObject({ schemaVersion: 2, adapter: { id: 'synthetic-nested', version: '1.0.0' },
      summary: { recordsValidated: count, warningsCount: count ? 0 : 1 },
      normalized: { groups: [{ id: 'g' }], items: expect.any(Array) } });
    expect(result.normalized.items.map(row => row.value)).toEqual(Array.from({ length: count }, (_, n) => 10 - n));
    expect(isResult(result)).toBe(true);
    expect(encode(result).byteLength).toBeLessThanOrEqual(PROCESSOR_RESULT_LIMIT);
  });

  it('accepts an empty nested container and reports empty groups without silently dropping them', async () => {
    expect(await process(nested([]))).toMatchObject({ summary: { recordsValidated: 0, warningsCount: 0 },
      normalized: { groups: [], items: [] } });
    expect(await process(nested([group('empty')]))).toMatchObject({
      warnings: ['EMPTY_GROUP'], normalized: { groups: [{ id: 'empty' }], items: [] },
    });
  });

  it('checks forward and cross-group references and canonicalizes order independently of IDs and values', async () => {
    for (const prefix of ['x', 'unrelated_27', 'user_93']) {
      const first = group(prefix + '_g1', [item(prefix + '_a', -7, prefix + '_b')]);
      const second = group(prefix + '_g2', [item(prefix + '_b', 42, prefix + '_a'), item(prefix + '_c', 0)]);
      const input = nested([second, first]);
      const output = await process(input);
      const reordered = await process(nested([first, { ...second, items: [...second.items].reverse() }]));
      expect(output.normalized).toEqual(reordered.normalized);
      expect(output.summary).toEqual(reordered.summary);
      expect(output.normalized.items.find(row => row.id === prefix + '_a').ref).toBe(prefix + '_b');
      expect(await process(input)).toEqual(output);
      expect(isResult(output)).toBe(true);
    }
  });

  it('selects by the same bytes for unrelated filenames and ignores file metadata', async () => {
    const input = nested([group('g', [item('a', 27)])]);
    const bytes = encode(input);
    const files = ['backup.dbi', 'other.json', 'renamed.bin'].map(name => new File([bytes], name, { type: 'text/plain' }));
    const results = await Promise.all(files.map(async file => processFile(await file.arrayBuffer(), vi.fn())));
    expect(results[0]).toEqual(results[1]);
    expect(results[1]).toEqual(results[2]);
    expect(isResult(results[0])).toBe(true);
  });

  it('admits a third reviewed adapter through registration and keeps selection independent of registration order', async () => {
    const third = { ...nestedAdapter, descriptor: { ...nestedAdapter.descriptor, adapterId: 'third-synthetic',
      format: 'third-synthetic-v1', formatFamily: 'third-synthetic' },
    detect: input => input.json?.format === 'third-synthetic-v1' ? 'match' : 'none',
    parse: input => nestedAdapter.parse({ ...input, json: { ...input.json, format: NESTED_FORMAT } }) };
    const input = { ...nested([group('g', [item('a', 9)])]), format: third.descriptor.format };
    for (const registrations of [[fixtureAdapter, third, nestedAdapter], [nestedAdapter, third, fixtureAdapter]]) {
      const processor = createProcessor(registrations);
      const result = await processor.processFile(encode(input), vi.fn());
      expect(result.adapter.id).toBe('third-synthetic');
      expect(processor.isResult(result)).toBe(true);
      expect(isResult(result)).toBe(false);
    }
    expect(adapterDescriptors.map(row => row.adapterId)).toEqual(['synthetic-fixture', 'synthetic-nested']);
  });

  it('allows a reviewed binary signature adapter without changing the common processing path', async () => {
    const binary = { ...nestedAdapter, descriptor: { ...nestedAdapter.descriptor, adapterId: 'test-binary',
      format: 'test-binary-v1', formatFamily: 'test-binary', detection: 'bounded-signature' },
    detect: input => new Uint8Array(input.bytes)[0] === 66 ? 'match' : 'none',
    parse: input => nestedAdapter.parse({ ...input, json: nested([group('g', [item('a', new Uint8Array(input.bytes)[1])])]) }) };
    const processor = createProcessor([fixtureAdapter, nestedAdapter, binary]);
    for (const value of [0, 7, 255]) {
      const output = await processor.processFile(new Uint8Array([66, value]).buffer, vi.fn());
      expect(output.normalized.items[0].value).toBe(value);
      expect(processor.isResult(output)).toBe(true);
    }
  });

  it('rejects ambiguity explicitly in either registry order without invoking either parser', async () => {
    const parse = vi.fn();
    const overlapping = { ...fixtureAdapter, descriptor: { ...fixtureAdapter.descriptor, adapterId: 'overlapping-fixture' }, parse };
    for (const adapters of [[fixtureAdapter, overlapping], [overlapping, fixtureAdapter]]) {
      await expect(createProcessor(adapters).processFile(encode(fixture([])), vi.fn()))
        .rejects.toMatchObject({ code: 'AMBIGUOUS_FORMAT' });
    }
    expect(parse).not.toHaveBeenCalled();
  });

  it('snapshots registration metadata and rejects invalid or repeated adapter identities', () => {
    const descriptor = { ...nestedAdapter.descriptor };
    const processor = createProcessor([{ ...nestedAdapter, descriptor }]);
    descriptor.adapterId = 'changed-after-registration';
    expect(processor.descriptors[0].adapterId).toBe('synthetic-nested');
    expect(() => createProcessor([nestedAdapter, nestedAdapter])).toThrow('INVALID_ADAPTER_REGISTRY');
    expect(() => createProcessor([{ ...nestedAdapter, descriptor: { ...nestedAdapter.descriptor, registration: 'unverified' } }]))
      .toThrow('INVALID_ADAPTER_REGISTRY');
  });

  it.each([
    ['binary content', 'UNSUPPORTED_FORMAT'],
    [{ arbitrary: true }, 'UNSUPPORTED_FORMAT'],
    [{ format: 'completely-new-v1' }, 'UNSUPPORTED_FORMAT'],
    [{ format: 'mezfit-migration-fixture-v9', records: [] }, 'UNSUPPORTED_FORMAT_VERSION'],
    [{ format: 'mezfit-migration-nested-v2', container: {} }, 'UNSUPPORTED_FORMAT_VERSION'],
  ])('returns a typed unsupported outcome for %j', async (input, errorCode) => {
    expect(await process(input)).toEqual({ status: 'unsupported', errorCode, detectedFormat: 'unknown' });
  });

  it.each([
    ['{', 'INVALID_INPUT_JSON'],
    [fixture(Array.from({ length: PROCESSOR_RECORD_LIMIT + 1 }, () => ({ value: 0 }))), 'INVALID_INPUT_SCHEMA'],
    [nested([group('g', [item('a', 1, 'missing')])]), 'DANGLING_REFERENCE'],
    [nested([group('g', [item('a'), item('a')])]), 'DUPLICATE_SOURCE_ID'],
    [nested([group('g'), group('g')]), 'DUPLICATE_SOURCE_ID'],
    [nested([group('g', [item('g')])]), 'DUPLICATE_SOURCE_ID'],
    [nested([group('g', [item('a', 1.5)])]), 'INVALID_INPUT_SCHEMA'],
    [nested([group('g', [item('a', 'private-user-content')])]), 'INVALID_INPUT_SCHEMA'],
    [nested([group('g', Array.from({ length: NESTED_RECORD_LIMIT + 1 }, (_, n) => item('i' + n)))]), 'ADAPTER_RECORD_LIMIT'],
    [nested(Array.from({ length: NESTED_RECORD_LIMIT + 1 }, (_, n) => group('g' + n))), 'ADAPTER_RECORD_LIMIT'],
    [{ format: NESTED_FORMAT, container: [] }, 'INVALID_INPUT_SCHEMA'],
    ['{"format":"mezfit-migration-fixture-v1","__proto__":{"polluted":true}}', 'INVALID_INPUT_SCHEMA'],
    ['{"format":"mezfit-migration-nested-v1","container":{"groups":[]},"constructor":{"prototype":{}}}', 'INVALID_INPUT_SCHEMA'],
    [nested([{ ...group('g'), extra: 'private-user-content' }]), 'INVALID_INPUT_SCHEMA'],
    [' '.repeat(PROCESSOR_INPUT_LIMIT + 1), 'PROCESSOR_INPUT_LIMIT'],
  ])('rejects known malformed input without falling back to unsupported (%s)', async (input, code) => {
    const logs = [];
    const emit = traceWriter({}, row => logs.push(row));
    await expect(processFile(encode(input), emit)).rejects.toMatchObject({ code, retryable: false });
    expect(JSON.stringify(logs)).not.toContain('private-user-content');
    expect(Object.prototype.polluted).toBeUndefined();
  });

  it('classifies invalid UTF-8 in JSON input separately from malformed JSON', async () => {
    await expect(processFile(new Uint8Array([123, 34, 255, 34, 125]).buffer, vi.fn()))
      .rejects.toMatchObject({ code: 'INVALID_INPUT_ENCODING' });
  });

  it('enforces result bytes separately from input bounds', async () => {
    const input = nested(Array.from({ length: 8 }, (_, n) =>
      group('long_group_' + n + '_'.repeat(15), [item('long_item_' + n + '_'.repeat(15), Number.MAX_SAFE_INTEGER)])));
    expect(encode(input).byteLength).toBeLessThan(PROCESSOR_INPUT_LIMIT);
    await expect(process(input)).rejects.toMatchObject({ code: 'RESULT_SIZE_LIMIT' });
  });

  it('rejects malformed transport results, mismatched versions, counts, links and extra fields', async () => {
    const output = await process(nested([group('g', [item('a', 5)])]));
    const reordered = clone(output);
    reordered.normalized.items = reordered.normalized.items.map(({ id, group, value, ref }) => ({ ref, value, group, id }));
    expect(isResult(reordered)).toBe(true);
    const mutations = [
      value => { value.adapter.version = '9.0.0'; },
      value => { value.schemaVersion = 99; },
      value => { value.summary.recordsValidated++; },
      value => { value.summary.warningsCount++; },
      value => { value.normalized.items[0].ref = 'absent'; },
      value => { value.normalized.items[0].group = 'absent'; },
      value => { value.normalized.items[0].value = '5'; },
      value => { value.normalized.groups.push({ id: 'g' }); },
      value => { value.inputSha256 = 'bad'; },
      value => { value.extra = 'unexpected'; },
      value => { value.warnings.push('unverified'); },
    ];
    for (const mutate of mutations) {
      const invalid = clone(output);
      mutate(invalid);
      expect(isResult(invalid)).toBe(false);
    }
  });

  it('retains only registered adapter identity and version in sanitized traces', async () => {
    const logs = [];
    await processFile(encode(nested([group('private_group', [item('private_item', 98765)])])),
      traceWriter({}, row => logs.push(row)));
    expect(logs).toContainEqual(expect.objectContaining({ event: 'ADAPTER_SELECTED', status: 'OK',
      details: { adapter_id: 'synthetic-nested', adapter_version: '1.0.0' } }));
    expect(JSON.stringify(logs)).not.toContain('private_group');
    expect(JSON.stringify(logs)).not.toContain('private_item');
    expect(JSON.stringify(logs)).not.toContain('98765');
  });
});
