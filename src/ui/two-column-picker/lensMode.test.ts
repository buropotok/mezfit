import { describe, expect, it } from 'vitest';
import {
  isIosPickerDevice,
  resolveTwoColumnPickerLensMode,
} from './lensMode';

describe('two-column picker lens mode', () => {
  it('uses ios mode automatically on iPhone', () => {
    const navigatorInfo = {
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)',
      maxTouchPoints: 5,
    };

    expect(isIosPickerDevice(navigatorInfo)).toBe(true);
    expect(resolveTwoColumnPickerLensMode('auto', navigatorInfo)).toBe('ios');
  });

  it('covers iPadOS desktop-style user agents', () => {
    expect(resolveTwoColumnPickerLensMode('auto', {
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)',
      maxTouchPoints: 5,
    })).toBe('ios');
  });

  it('keeps displacement mode on non-iOS devices and honors explicit overrides', () => {
    const android = {
      userAgent: 'Mozilla/5.0 (Linux; Android 15; Pixel)',
      maxTouchPoints: 5,
    };

    expect(resolveTwoColumnPickerLensMode('auto', android)).toBe('displacement');
    expect(resolveTwoColumnPickerLensMode('ios', android)).toBe('ios');
    expect(resolveTwoColumnPickerLensMode('displacement', {
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)',
      maxTouchPoints: 5,
    })).toBe('displacement');
  });
});
