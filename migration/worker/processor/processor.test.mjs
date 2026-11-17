import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { FIXTURE_FORMAT, PROCESSOR_INPUT_LIMIT, PROCESSOR_RECORD_LIMIT } from '../../processor-protocol.mjs';
import { isResult, processFile } from './index';

const encode = value => new TextEncoder().encode(value).buffer;
const fixture = records => JSON.stringify({ format: FIXTURE_FORMAT, records });

describe('migration fixture processor', () => {
  it('validates and hashes the exact fixture bytes, even at both configured bounds', async () => {
    const bytes = encode(fixture(Array.from({ length: PROCESSOR_RECORD_LIMIT }, (_, value) => ({ value })))
      .padEnd(PROCESSOR_INPUT_LIMIT, ' '));
    const emit = vi.fn();
    const result = await processFile(bytes, emit);

    expect(result).toEqual({
      status: 'succeeded', schemaVersion: 1, processorVersion: 'v1', detectedFormat: FIXTURE_FORMAT,
      inputSizeBytes: PROCESSOR_INPUT_LIMIT, inputSha256: createHash('sha256').update(new Uint8Array(bytes)).digest('hex'),
      summary: { recordsValidated: PROCESSOR_RECORD_LIMIT, warningsCount: 0 }, warnings: [],
    });
    expect(isResult(result)).toBe(true);
    expect(isResult({ ...result, warnings: ['unexpected'] })).toBe(false);
    expect(emit).toHaveBeenCalledWith('processor', 'transformation', 'TRANSFORMATION_COMPLETED', 'OK', expect.any(Object));
  });

  it.each([
    ['', 'EMPTY_INPUT'],
    ['{', 'INVALID_INPUT_JSON'],
    [fixture([{ value: '1' }]), 'INVALID_INPUT_SCHEMA'],
    [fixture([{ value: 1, private: 'sensitive' }]), 'INVALID_INPUT_SCHEMA'],
    [' '.repeat(PROCESSOR_INPUT_LIMIT + 1), 'PROCESSOR_INPUT_LIMIT'],
  ])('rejects invalid input with a stable code and safe diagnostic', async (input, code) => {
    const emit = vi.fn();
    await expect(processFile(encode(input), emit)).rejects.toMatchObject({ code, retryable: false });
    expect(emit).toHaveBeenCalledWith('processor', 'processing', 'PROCESSOR_FAILED', 'FAILED',
      expect.objectContaining({ error_code: code }));
    expect(JSON.stringify(emit.mock.calls)).not.toContain('sensitive');
  });

  it.each(['different binary format', '{"format":"different-fixture"}'])('reports an unsupported format', async input => {
    const emit = vi.fn();
    await expect(processFile(encode(input), emit)).resolves.toMatchObject({
      status: 'unsupported', errorCode: 'UNSUPPORTED_FORMAT',
    });
    expect(emit).toHaveBeenCalledWith('processor', 'format-detection', 'FORMAT_UNSUPPORTED', 'SKIPPED', expect.any(Object));
  });
});
