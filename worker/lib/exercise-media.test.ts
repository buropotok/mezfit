import { describe, expect, it } from 'vitest';
import {
  exerciseMediaPublicUrl,
  exerciseMediaR2Key,
  isApprovedGymKeeperMediaUrl,
} from './exercise-media';

const birdDogKey = '12411305-Bird-Dog-male_Back_180.gif';

describe('Gym Keeper exercise media mapping', () => {
  it('uses one stable R2 object key per APK reference key', () => {
    expect(exerciseMediaR2Key('gym_keeper_apk', birdDogKey))
      .toBe(`exercise-media/gym_keeper_apk/${birdDogKey}`);
  });

  it('exposes a same-origin media URL only for the APK source', () => {
    expect(exerciseMediaPublicUrl('gym_keeper_apk', birdDogKey))
      .toBe(`/api/exercise-media/gym_keeper_apk/${birdDogKey}`);
    expect(exerciseMediaPublicUrl(null, birdDogKey)).toBeNull();
    expect(exerciseMediaPublicUrl('coach', birdDogKey)).toBeNull();
    expect(exerciseMediaPublicUrl('gym_keeper_apk', null)).toBeNull();
  });

  it('only accepts the approved Gym Keeper GIF source path', () => {
    expect(isApprovedGymKeeperMediaUrl(`https://47-1594.s.cdn13.com/img/gifs/180/${birdDogKey}`)).toBe(true);
    expect(isApprovedGymKeeperMediaUrl(`http://47-1594.s.cdn13.com/img/gifs/180/${birdDogKey}`)).toBe(false);
    expect(isApprovedGymKeeperMediaUrl(`https://example.com/img/gifs/180/${birdDogKey}`)).toBe(false);
    expect(isApprovedGymKeeperMediaUrl(`https://47-1594.s.cdn13.com/other/${birdDogKey}`)).toBe(false);
  });
});
