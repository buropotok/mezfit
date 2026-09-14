import { describe, expect, it } from 'vitest';
import { parseBootDiagnosticPayload } from './boot-diagnostics';

const validPayload = {
  sessionId: 'boot-abc12345',
  stage: 'me-request-timeout',
  lastStage: 'me-request-start',
  elapsedMs: 10000,
  path: '/',
  userAgent: 'Mozilla/5.0',
  online: true,
  telegram: {
    available: true,
    version: '8.0',
    platform: 'android',
  },
  details: {
    timeoutMs: 10000,
  },
};

describe('parseBootDiagnosticPayload', () => {
  it('accepts a bounded startup diagnostic payload', () => {
    expect(parseBootDiagnosticPayload(validPayload)).toEqual(validPayload);
  });

  it('rejects unexpected detail fields', () => {
    expect(parseBootDiagnosticPayload({
      ...validPayload,
      details: { extra: 'not-allowed' },
    })).toBeNull();
  });

  it('rejects malformed stages and unbounded user agents', () => {
    expect(parseBootDiagnosticPayload({ ...validPayload, stage: '../bad' })).toBeNull();
    expect(parseBootDiagnosticPayload({ ...validPayload, userAgent: 'x'.repeat(401) })).toBeNull();
  });
});
