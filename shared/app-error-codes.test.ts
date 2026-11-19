import { describe, expect, it } from 'vitest';
import { APP_ERROR_CODES, withErrorCode } from './app-error-codes';

describe('user-facing support codes', () => {
  it('appends a stable code at the end without changing the original explanation', () => {
    expect(withErrorCode('Не удалось открыть видео', APP_ERROR_CODES.MEDIA_VIDEO_DECODE_FAILED))
      .toBe('Не удалось открыть видео (Код: MEDIA_VIDEO_DECODE_FAILED)');
  });

  it('never duplicates a previously attached code', () => {
    const message = withErrorCode('Ошибка', APP_ERROR_CODES.MEDIA_CHECK_TIMEOUT);
    expect(withErrorCode(message, APP_ERROR_CODES.MEDIA_CHECK_TIMEOUT)).toBe(message);
  });

  it('does not expose arbitrary untrusted values as codes', () => {
    expect(withErrorCode('Ошибка', 'PRIVATE=value')).toBe('Ошибка (Код: UNKNOWN_ERROR)');
  });
});
