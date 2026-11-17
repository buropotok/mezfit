import { PROCESSOR_INPUT_LIMIT, PROCESSOR_RECORD_LIMIT } from '../../processor-protocol.mjs';
import { ProcessingFailure, type AdapterInput, type ImportAdapter } from './contracts';

// This factory accepts only trusted, statically imported code. Discovery
// candidates have a separate data-only contract and no runtime admission API.
export function createAdapterRegistry(adapters: readonly ImportAdapter[]) {
  if (!adapters.length || adapters.length > 16) throw new ProcessingFailure('INVALID_ADAPTER_REGISTRY');
  const registered = Object.freeze(adapters.map(adapter => Object.freeze({
    descriptor: Object.freeze({ ...adapter.descriptor }), detect: adapter.detect, parse: adapter.parse, validate: adapter.validate,
  })));
  const identities = new Set<string>();
  for (const { descriptor } of registered) {
    if (descriptor.registration !== 'reviewed' || !['bounded-json-marker', 'bounded-signature'].includes(descriptor.detection)
      || !/^[a-z][a-z0-9-]{0,63}$/.test(descriptor.adapterId) || identities.has(descriptor.adapterId)
      || !/^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(descriptor.adapterVersion)
      || !/^[a-z][a-z0-9-]{0,79}$/.test(descriptor.formatFamily)
      || !descriptor.format.startsWith(descriptor.formatFamily + '-v')
      || !Number.isSafeInteger(descriptor.maxInputBytes) || descriptor.maxInputBytes <= 0
      || descriptor.maxInputBytes > PROCESSOR_INPUT_LIMIT || !Number.isSafeInteger(descriptor.maxRecords)
      || descriptor.maxRecords < 0 || descriptor.maxRecords > PROCESSOR_RECORD_LIMIT
      || ![1, 2].includes(descriptor.resultSchemaVersion)) throw new ProcessingFailure('INVALID_ADAPTER_REGISTRY');
    identities.add(descriptor.adapterId);
  }
  return Object.freeze({
    adapters: registered,
    descriptors: Object.freeze(registered.map(adapter => adapter.descriptor)),
    select(input: AdapterInput): { adapter: ImportAdapter; errorCode?: never } |
      { adapter?: never; errorCode: 'UNSUPPORTED_FORMAT' | 'UNSUPPORTED_FORMAT_VERSION' } {
      const detected = registered.map(adapter => ({ adapter, outcome: adapter.detect(input) }));
      const matches = detected.filter(item => item.outcome === 'match');
      if (matches.length > 1) throw new ProcessingFailure('AMBIGUOUS_FORMAT');
      if (matches.length === 1) return { adapter: matches[0].adapter };
      const errorCode = detected.some(item => item.outcome === 'unsupported-version')
        ? 'UNSUPPORTED_FORMAT_VERSION' : 'UNSUPPORTED_FORMAT';
      return { errorCode } as const;
    },
  });
}
