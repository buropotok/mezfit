import { describe, expect, it } from 'vitest';
import { cloudSyncErrorCode } from './cloudSyncErrorCode';

describe('safe Dexie Cloud synchronization error codes', () => {
  it('classifies SDK HttpError failures by HTTP status', () => {
    expect(cloudSyncErrorCode({ name: 'HttpError', message: '403 Forbidden', httpStatus: 403 }))
      .toBe('HTTP_403');
    expect(cloudSyncErrorCode(new Error('401 Unauthorized'))).toBe('HTTP_401');
    expect(cloudSyncErrorCode(new Error('Sync error: HttpError: 502 Bad Gateway')))
      .toBe('HTTP_502');
  });

  it('recognizes fetch/network failures from the sync worker', () => {
    expect(cloudSyncErrorCode(new TypeError('Failed to fetch'))).toBe('NETWORK_ERROR');
    expect(cloudSyncErrorCode('NetworkError when attempting to fetch resource'))
      .toBe('NETWORK_ERROR');
  });

  it('recognizes a cloud license error without exposing the raw message', () => {
    expect(cloudSyncErrorCode(new Error('License has expired'))).toBe('CLOUD_LICENSE');
  });

  it('avoids exposing unknown error strings and embedded credentials', () => {
    const payload = 'Bearer signed-secret-token https://api.example.com/access';
    expect(cloudSyncErrorCode(new Error(payload))).toBe('OTHER_SYNC_ERROR');
    expect(cloudSyncErrorCode({ message: payload, httpStatus: 'secret' }))
      .toBe('OTHER_SYNC_ERROR');
    expect(cloudSyncErrorCode('Error: ' + payload)).not.toContain(payload);
  });

  it('does not mistake unrelated HTTP status digits in an error body for a response status', () => {
    expect(cloudSyncErrorCode(new Error('Member 403: ' + 'private-user')))
      .toBe('OTHER_SYNC_ERROR');
  });

  it('handles empty/unsupported error values predictably', () => {
    expect(cloudSyncErrorCode(undefined)).toBeNull();
    expect(cloudSyncErrorCode(null)).toBeNull();
    expect(cloudSyncErrorCode({})).toBe('OTHER_SYNC_ERROR');
    expect(cloudSyncErrorCode(42)).toBe('OTHER_SYNC_ERROR');
  });
});
