import { describe, expect, it } from 'vitest';
import {
  exerciseMediaPublicUrl,
  exerciseMediaR2Key,
  isApprovedGymKeeperMediaUrl,
} from './exercise-media';

describe('Gym Keeper exercise media mapping', () => {
  it('uses one stable R2 object key per APK reference key', () => {
    expect(exerciseMediaR2Key('gym_keeper_apk', '12411305-Bird-Dog-male_Back_180.gif'))
      .toBe('exercise-media/gym_keeper_apk/12411305-Bird-Dog-male_Back_180.gif');
  });

  it('exposes a same-origin media URL only when a source mapping exists', () => {
    expect(exerciseMediaPublicUrl(205, true)).toBe('/api/exercise-media/205');
    expect(exerciseMediaPublicUrl(205, false)).toBeNull();
  });

  it('only accepts the approved Gym Keeper GIF source path', () => {
    expect(isApprovedGymKeeperMediaUrl('https://47-1594.s.cdn13.com/img/gifs/180/12411305-Bird-Dog-male_Back_180.gif')).toBe(true);
    expect(isApprovedGymKeeperMediaUrl('http://47-1594.s.cdn13.com/img/gifs/180/12411305-Bird-Dog-male_Back_180.gif')).toBe(false);
    expect(isApprovedGymKeeperMediaUrl('https://example.com/img/gifs/180/12411305-Bird-Dog-male_Back_180.gif')).toBe(false);
    expect(isApprovedGymKeeperMediaUrl('https://47-1594.s.cdn13.com/other/12411305-Bird-Dog-male_Back_180.gif')).toBe(false);
  });
});
