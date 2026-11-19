export const PROCESSOR_VERSION: 'v1';
export const FIXTURE_FORMAT: 'mezfit-migration-fixture-v1';
export const PROCESSOR_INPUT_LIMIT: number;
export const PROCESSOR_RECORD_LIMIT: number;
export const PROCESSOR_RESULT_LIMIT: number;
export const SOURCE_PACKAGE_RESULT_LIMIT: number;
export function processorResultLimit(schemaVersion: unknown): number;
export function processorInstanceId(id: string): string;
export function processorResultKey(id: string): string;
