export const PROCESSOR_VERSION = 'v1';
export const FIXTURE_FORMAT = 'mezfit-migration-fixture-v1';
export const PROCESSOR_INPUT_LIMIT = 8192;
export const PROCESSOR_RECORD_LIMIT = 256;
export const PROCESSOR_RESULT_LIMIT = 1024;

export function processorInstanceId(id) {
  return 'process-' + PROCESSOR_VERSION + '-' + id;
}

export function processorResultKey(id) {
  return 'results/' + id + '/' + PROCESSOR_VERSION + '/result.json';
}
