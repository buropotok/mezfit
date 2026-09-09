import { describe, expect, it } from 'vitest';
import { gymKeeperIcons } from './gymKeeperIcons';

describe('Gym Keeper navigation icons', () => {
  it('provides APK-derived data assets for every navigation semantic', () => {
    expect(Object.keys(gymKeeperIcons)).toEqual([
      'clients',
      'programs',
      'exercises',
      'calendar',
      'today',
      'history',
      'progress',
      'settings',
      'about',
      'back',
      'menu',
    ]);

    for (const asset of Object.values(gymKeeperIcons)) {
      expect(asset).toMatch(/^url\("data:image\/png;base64,[A-Za-z0-9+/=]+"\)$/);
    }
  });
});
