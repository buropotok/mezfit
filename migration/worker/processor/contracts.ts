import { PROCESSOR_VERSION } from '../../processor-protocol.mjs';

// Transport collections only. Business PLAN/FACT normalization is a later boundary.
export type NormalizedPayload = { [collection: string]: { [field: string]: string | number | boolean | null }[] };
export type AdapterInput = { readonly bytes: ArrayBuffer; readonly json: unknown };
export type AdapterData = { recordsValidated: number; warnings: string[]; normalized: NormalizedPayload | null };
export type InputProvenance = { inputSizeBytes: number; inputSha256: string };
type SuccessBase = InputProvenance & {
  status: 'succeeded';
  processorVersion: typeof PROCESSOR_VERSION;
  detectedFormat: string;
  summary: { recordsValidated: number; warningsCount: number };
  warnings: string[];
};
export type Success = SuccessBase & ({ schemaVersion: 1 } | {
  schemaVersion: 2;
  adapter: { id: string; version: string };
  normalized: NormalizedPayload;
});
export type Unsupported = {
  status: 'unsupported';
  errorCode: 'UNSUPPORTED_FORMAT' | 'UNSUPPORTED_FORMAT_VERSION';
  detectedFormat: 'unknown';
};
export type ProcessingResult = Success | Unsupported;

export type AdapterDescriptor = {
  readonly adapterId: string;
  readonly adapterVersion: string;
  readonly format: string;
  readonly formatFamily: string;
  readonly registration: 'reviewed';
  readonly detection: 'bounded-json-marker' | 'bounded-signature';
  readonly maxInputBytes: number;
  readonly maxRecords: number;
  readonly resultSchemaVersion: 1 | 2;
};
export interface ImportAdapter {
  readonly descriptor: AdapterDescriptor;
  detect(input: AdapterInput): 'match' | 'unsupported-version' | 'none';
  parse(input: AdapterInput): AdapterData;
  validate(data: unknown): data is AdapterData;
}

// Offline discovery output has no executable adapter and cannot be registered.
// Promotion requires reviewed code + fixtures + deterministic replay validation.
export type AdapterDiscoveryRequest = {
  reason: Unsupported['errorCode'];
  input: InputProvenance;
  registered: readonly AdapterDescriptor[];
};
export type AdapterCandidate = {
  status: 'unverified';
  proposedAdapterId: string;
  proposedVersion: string;
  specification: string;
  fixtureSha256: readonly string[];
};

export class ProcessingFailure extends Error {
  constructor(readonly code: string, readonly retryable = false) {
    super(code);
  }
}

export const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}

export function jsonMarker(input: unknown, format: string, family: string): ReturnType<ImportAdapter['detect']> {
  if (!record(input) || typeof input.format !== 'string') return 'none';
  if (input.format === format) return 'match';
  return input.format.startsWith(family + '-v') ? 'unsupported-version' : 'none';
}
