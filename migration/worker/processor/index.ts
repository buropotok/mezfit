import { FIXTURE_FORMAT, PROCESSOR_INPUT_LIMIT, PROCESSOR_RECORD_LIMIT, PROCESSOR_VERSION } from '../../processor-protocol.mjs';
import type { Trace } from '../../trace.mjs';

interface Success {
  status: 'succeeded';
  schemaVersion: 1;
  processorVersion: typeof PROCESSOR_VERSION;
  detectedFormat: typeof FIXTURE_FORMAT;
  inputSizeBytes: number;
  inputSha256: string;
  summary: { recordsValidated: number; warningsCount: 0 };
  warnings: [];
}

type Unsupported = { status: 'unsupported'; errorCode: 'UNSUPPORTED_FORMAT'; detectedFormat: 'unknown' };
export type ProcessingResult = Success | Unsupported;

export class ProcessingFailure extends Error {
  constructor(readonly code: string, readonly retryable = false) {
    super(code);
  }
}

const SHA256 = /^[a-f0-9]{64}$/;
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export function isResult(value: unknown): value is Success {
  return record(value) && Object.keys(value).length === 8
    && value.status === 'succeeded' && value.schemaVersion === 1 && value.processorVersion === PROCESSOR_VERSION
    && value.detectedFormat === FIXTURE_FORMAT
    && typeof value.inputSizeBytes === 'number' && Number.isSafeInteger(value.inputSizeBytes)
    && value.inputSizeBytes > 0 && value.inputSizeBytes <= PROCESSOR_INPUT_LIMIT
    && typeof value.inputSha256 === 'string' && SHA256.test(value.inputSha256)
    && record(value.summary) && Object.keys(value.summary).length === 2 && value.summary.warningsCount === 0
    && typeof value.summary.recordsValidated === 'number' && Number.isSafeInteger(value.summary.recordsValidated)
    && value.summary.recordsValidated >= 0 && value.summary.recordsValidated <= PROCESSOR_RECORD_LIMIT
    && Array.isArray(value.warnings) && value.warnings.length === 0;
}

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

export async function processFile(bytes: ArrayBuffer, emit: Trace): Promise<ProcessingResult> {
  const start = Date.now();
  emit('processor', 'processing', 'PROCESSOR_STARTED', 'STARTED');
  emit('processor', 'processor-version', 'PROCESSOR_VERSION_CONFIRMED', 'OK');
  try {
    phase(emit, 'INPUT_VALIDATION', () => {
      if (bytes.byteLength === 0) throw new ProcessingFailure('EMPTY_INPUT');
      if (bytes.byteLength > PROCESSOR_INPUT_LIMIT) throw new ProcessingFailure('PROCESSOR_INPUT_LIMIT');
    }, () => bytes.byteLength);
    const text = phase(emit, 'FORMAT_DETECTION', () => {
      // Check only the bounded input. JSON-looking malformed text is a
      // validation failure, whereas binary and unrelated formats are unsupported.
      const prefix = new Uint8Array(bytes).find(byte => byte !== 9 && byte !== 10 && byte !== 13 && byte !== 32);
      if (prefix !== 123 && prefix !== 91) return null;
      try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
      catch { throw new ProcessingFailure('INVALID_INPUT_ENCODING'); }
    });
    const input = text === null ? null : phase(emit, 'INPUT_PARSING', () => {
      try { return JSON.parse(text) as unknown; }
      catch { throw new ProcessingFailure('INVALID_INPUT_JSON'); }
    });
    if (!record(input) || input.format !== FIXTURE_FORMAT) {
      emit('processor', 'format-detection', 'FORMAT_UNSUPPORTED', 'SKIPPED', { actual: 'unknown-format',
        error_code: 'UNSUPPORTED_FORMAT' });
      emit('processor', 'processing', 'PROCESSOR_COMPLETED', 'OK', { actual: 'unsupported', duration_ms: Date.now() - start });
      return { status: 'unsupported', errorCode: 'UNSUPPORTED_FORMAT', detectedFormat: 'unknown' };
    }
    const count = phase(emit, 'RECORD_VALIDATION', () => {
      if (Object.keys(input).length !== 2 || !Array.isArray(input.records) || input.records.length > PROCESSOR_RECORD_LIMIT
        || !input.records.every(item => record(item) && Object.keys(item).length === 1
          && typeof item.value === 'number' && Number.isSafeInteger(item.value))) {
        throw new ProcessingFailure('INVALID_INPUT_SCHEMA');
      }
      return input.records.length;
    }, value => value);
    const digestStarted = Date.now();
    const checksum = await sha256(bytes);
    emit('processor', 'input-digest', 'INPUT_SHA256_CALCULATED', 'OK', { duration_ms: Date.now() - digestStarted });
    const result = phase<Success>(emit, 'TRANSFORMATION', () => ({
      status: 'succeeded', schemaVersion: 1, processorVersion: PROCESSOR_VERSION, detectedFormat: FIXTURE_FORMAT,
      inputSizeBytes: bytes.byteLength, inputSha256: checksum, summary: { recordsValidated: count, warningsCount: 0 }, warnings: [],
    }));
    phase(emit, 'RESULT_SCHEMA_VALIDATION', () => {
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
