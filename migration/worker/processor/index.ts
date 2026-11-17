import { PROCESSOR_INPUT_LIMIT, PROCESSOR_RESULT_LIMIT, PROCESSOR_VERSION } from '../../processor-protocol.mjs';
import type { Trace } from '../../trace.mjs';
import { fixtureAdapter } from './adapters/fixture';
import { nestedAdapter } from './adapters/nested';
import { exactKeys, ProcessingFailure, record, type ImportAdapter, type ProcessingResult, type Success } from './contracts';
import { createAdapterRegistry } from './registry';

export { ProcessingFailure } from './contracts';
export type { AdapterCandidate, AdapterData, AdapterInput, AdapterDescriptor, AdapterDiscoveryRequest, ImportAdapter, ProcessingResult, Success } from './contracts';

const SHA256 = /^[a-f0-9]{64}$/;
const integer = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

export async function sha256(bytes: ArrayBuffer): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('');
}

function phase<T>(emit: Trace, event: string, action: () => T, count?: (value: T) => number): T {
  const stage = event.toLowerCase().replaceAll('_', '-');
  const start = Date.now();
  emit('processor', stage, event + '_STARTED', 'STARTED', { expected: 'completed' });
  try {
    const value = action();
    emit('processor', stage, event + '_COMPLETED', 'OK', { actual: 'completed', duration_ms: Date.now() - start,
      details: { count: count?.(value) } });
    return value;
  } catch (error) {
    emit('processor', stage, event + '_FAILED', 'FAILED', { duration_ms: Date.now() - start,
      error_code: error instanceof ProcessingFailure ? error.code : 'PROCESSOR_RUNTIME_FAILURE' });
    throw error;
  }
}

// A private registry per processor allows deterministic tests and future static
// registrations without mutable global plugin state or Workflow source branches.
export function createProcessor(adapters: readonly ImportAdapter[]) {
  const registry = createAdapterRegistry(adapters);
  function isResult(value: unknown): value is Success {
    if (!record(value) || value.status !== 'succeeded' || value.processorVersion !== PROCESSOR_VERSION
      || !integer(value.inputSizeBytes) || value.inputSizeBytes === 0 || value.inputSizeBytes > PROCESSOR_INPUT_LIMIT
      || typeof value.inputSha256 !== 'string' || !SHA256.test(value.inputSha256)
      || !record(value.summary) || !exactKeys(value.summary, ['recordsValidated', 'warningsCount'])
      || !integer(value.summary.recordsValidated) || !integer(value.summary.warningsCount)
      || !Array.isArray(value.warnings) || value.warnings.length !== value.summary.warningsCount
      || !value.warnings.every(code => typeof code === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/.test(code))) return false;
    const compatible = registry.adapters.filter(adapter => adapter.descriptor.format === value.detectedFormat
      && adapter.descriptor.resultSchemaVersion === value.schemaVersion);
    if (compatible.length !== 1) return false;
    const adapter = compatible[0];
    if (value.inputSizeBytes > adapter.descriptor.maxInputBytes
      || value.summary.recordsValidated > adapter.descriptor.maxRecords) return false;
    const keys = ['status', 'schemaVersion', 'processorVersion', 'detectedFormat', 'inputSizeBytes', 'inputSha256', 'summary', 'warnings'];
    if (value.schemaVersion === 2) {
      if (!record(value.adapter) || !exactKeys(value.adapter, ['id', 'version'])
        || value.adapter.id !== adapter.descriptor.adapterId || value.adapter.version !== adapter.descriptor.adapterVersion
        || !exactKeys(value, [...keys, 'adapter', 'normalized'])) return false;
    } else if (value.schemaVersion !== 1 || !exactKeys(value, keys)) return false;
    const normalized = value.schemaVersion === 1 ? null : value.normalized;
    if (!adapter.validate({ recordsValidated: value.summary.recordsValidated, warnings: value.warnings, normalized })) return false;
    return new TextEncoder().encode(JSON.stringify(value)).byteLength <= PROCESSOR_RESULT_LIMIT;
  }

  async function processFile(bytes: ArrayBuffer, emit: Trace): Promise<ProcessingResult> {
    const start = Date.now();
    emit('processor', 'processing', 'PROCESSOR_STARTED', 'STARTED');
    emit('processor', 'processor-version', 'PROCESSOR_VERSION_CONFIRMED', 'OK');
    try {
      phase(emit, 'INPUT_VALIDATION', () => {
        if (bytes.byteLength === 0) throw new ProcessingFailure('EMPTY_INPUT');
        if (bytes.byteLength > PROCESSOR_INPUT_LIMIT) throw new ProcessingFailure('PROCESSOR_INPUT_LIMIT');
      }, () => bytes.byteLength);
      const text = phase(emit, 'FORMAT_DETECTION', () => {
        const prefix = new Uint8Array(bytes).find(byte => byte !== 9 && byte !== 10 && byte !== 13 && byte !== 32);
        if (prefix !== 123 && prefix !== 91) return null;
        try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
        catch { throw new ProcessingFailure('INVALID_INPUT_ENCODING'); }
      });
      const input: unknown = text === null ? null : phase(emit, 'INPUT_PARSING', () => {
        try { return JSON.parse(text) as unknown; }
        catch { throw new ProcessingFailure('INVALID_INPUT_JSON'); }
      });
      const source = { bytes, json: input };
      const selected = phase(emit, 'ADAPTER_SELECTION', () => registry.select(source));
      if (!selected.adapter) {
        emit('processor', 'format-detection', 'FORMAT_UNSUPPORTED', 'SKIPPED', { actual: 'unknown-or-incompatible-format',
          error_code: selected.errorCode });
        emit('processor', 'processing', 'PROCESSOR_COMPLETED', 'OK', { actual: 'unsupported', duration_ms: Date.now() - start });
        return { status: 'unsupported', errorCode: selected.errorCode, detectedFormat: 'unknown' };
      }
      const adapter = selected.adapter;
      emit('processor', 'adapter-selection', 'ADAPTER_SELECTED', 'OK', {
        details: { adapter_id: adapter.descriptor.adapterId, adapter_version: adapter.descriptor.adapterVersion } });
      const data = phase(emit, 'RECORD_VALIDATION', () => {
        if (bytes.byteLength > adapter.descriptor.maxInputBytes) throw new ProcessingFailure('PROCESSOR_INPUT_LIMIT');
        const parsed = adapter.parse(source);
        if (!adapter.validate(parsed) || parsed.recordsValidated > adapter.descriptor.maxRecords) {
          throw new ProcessingFailure('INVALID_ADAPTER_OUTPUT');
        }
        return parsed;
      }, value => value.recordsValidated);
      const digestStarted = Date.now();
      const checksum = await sha256(bytes);
      emit('processor', 'input-digest', 'INPUT_SHA256_CALCULATED', 'OK', { duration_ms: Date.now() - digestStarted });
      const result = phase<Success>(emit, 'TRANSFORMATION', () => {
        const common = {
          status: 'succeeded', processorVersion: PROCESSOR_VERSION, detectedFormat: adapter.descriptor.format,
          inputSizeBytes: bytes.byteLength, inputSha256: checksum,
          summary: { recordsValidated: data.recordsValidated, warningsCount: data.warnings.length }, warnings: data.warnings,
        } as const;
        // Preserve the released v1 JSON field order and its byte checksum.
        if (adapter.descriptor.resultSchemaVersion === 1) return {
          status: common.status, schemaVersion: 1, processorVersion: common.processorVersion,
          detectedFormat: common.detectedFormat, inputSizeBytes: common.inputSizeBytes,
          inputSha256: common.inputSha256, summary: common.summary, warnings: common.warnings,
        };
        if (!data.normalized) throw new ProcessingFailure('INVALID_ADAPTER_OUTPUT');
        return { ...common, schemaVersion: 2, adapter: { id: adapter.descriptor.adapterId,
          version: adapter.descriptor.adapterVersion }, normalized: data.normalized };
      });
      phase(emit, 'RESULT_SCHEMA_VALIDATION', () => {
        if (new TextEncoder().encode(JSON.stringify(result)).byteLength > PROCESSOR_RESULT_LIMIT) {
          throw new ProcessingFailure('RESULT_SIZE_LIMIT');
        }
        if (!isResult(result)) throw new ProcessingFailure('INVALID_RESULT_SCHEMA');
      });
      emit('processor', 'processing', 'PROCESSOR_COMPLETED', 'OK', { actual: 'succeeded', duration_ms: Date.now() - start });
      return result;
    } catch (error) {
      emit('processor', 'processing', 'PROCESSOR_FAILED', 'FAILED', { duration_ms: Date.now() - start,
        error_code: error instanceof ProcessingFailure ? error.code : 'PROCESSOR_RUNTIME_FAILURE' });
      throw error;
    }
  }
  return Object.freeze({ processFile, isResult, descriptors: registry.descriptors });
}

const processor = createProcessor([fixtureAdapter, nestedAdapter]);
export const processFile = processor.processFile;
export const isResult = processor.isResult;
export const adapterDescriptors = processor.descriptors;
