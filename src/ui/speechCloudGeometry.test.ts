import { describe, expect, it } from 'vitest';
import {
  createSpeechCloudMotion, nearestSpeechCloudPoint, placeSpeechCloud,
  speechCloudAvatarScale, speechCloudBendSide, speechCloudDimPath, speechCloudTail,
} from './speechCloudGeometry';

const source = { x: 36, y: 60, w: 44, h: 44 };
const area = { left: 16, top: 16, width: 343, height: 700 };

describe('SpeechCloud placement and motion', () => {
  it('fits a narrow viewport and reserves space for the 150% avatar', () => {
    const rect = placeSpeechCloud(source, 300, 170, area);
    expect(rect.x - rect.w / 2).toBeGreaterThanOrEqual(area.left);
    expect(rect.x + rect.w / 2).toBeLessThanOrEqual(area.left + area.width);
    expect(rect.y - rect.h / 2).toBeGreaterThanOrEqual(source.y + source.h * .75);
  });
  it('places above a low avatar and keeps long text in available space', () => {
    const low = { ...source, x: 180, y: 690 };
    const rect = placeSpeechCloud(low, 300, 2000, area);
    expect(rect.y - rect.h / 2).toBeGreaterThanOrEqual(area.top);
    expect(rect.y + rect.h / 2).toBeLessThanOrEqual(low.y - low.h * .75);
  });
  it('keeps a short reply compact', () => {
    expect(placeSpeechCloud(source, 110, 70, area).w).toBe(110);
  });
  it('ends at a superellipse rather than a rectangular popover', () => {
    const rect = placeSpeechCloud(source, 300, 170, area);
    const motion = createSpeechCloudMotion(source, rect);
    const geometry = motion.geometry(motion.morphStart);
    expect(geometry.a * 2).toBeCloseTo(rect.w);
    expect(geometry.b * 2).toBeCloseTo(rect.h);
    expect(geometry.n).toBeGreaterThan(2);
    const near = nearestSpeechCloudPoint(motion.contour(motion.morphStart), source);
    expect(near).not.toBeNull();
  });
});

describe('SpeechCloud curved tail', () => {
  const loops = [[{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }]];
  const avatar = { x: 160, y: 50, w: 44, h: 44 };
  it('finds the nearest edge point, including diagonal positions', () => {
    expect(nearestSpeechCloudPoint(loops, avatar)).toEqual({ x: 100, y: 50 });
    expect(nearestSpeechCloudPoint(loops, { x: 150, y: 150 })).toEqual({ x: 100, y: 100 });
  });
  it('has no tail before its delayed progress starts; curves without entering the avatar', () => {
    expect(speechCloudTail(loops, avatar, 0, 12, 1)).toEqual([]);
    const tail = speechCloudTail(loops, avatar, 1, 12, 1)[0];
    expect(tail.every(point => Number.isFinite(point.x) && Number.isFinite(point.y))).toBe(true);
    expect(Math.max(...tail.map(point => point.x))).toBeLessThan(avatar.x - avatar.w / 2);
    expect(speechCloudBendSide(loops, avatar, { x: 50, y: 50 })).toBe(1);
  });
  it('omits the tail when the body already touches the avatar', () => {
    expect(speechCloudTail(loops, { ...avatar, x: 110 }, 1, 12, 1)).toEqual([]);
  });
});

describe('SpeechCloud avatar emphasis', () => {
  it('scales smoothly to 150%, holds for 200ms and settles at 400ms', () => {
    expect(speechCloudAvatarScale(0)).toBe(1);
    expect(speechCloudAvatarScale(50)).toBeCloseTo(1.25);
    for (const t of [100, 200, 300]) expect(speechCloudAvatarScale(t)).toBe(1.5);
    expect(speechCloudAvatarScale(350)).toBeCloseTo(1.25);
    expect(speechCloudAvatarScale(400)).toBe(1);
    expect(speechCloudAvatarScale(1000)).toBe(1);
  });
  it('cuts the dimmer at the transformed avatar bounds', () => {
    const path = speechCloudDimPath(375, 812, { x: 50, y: 80, w: 66, h: 66 });
    expect(path).toContain('M0 0H375V812H0Z');
    expect(path).toContain('M17 80a33 33');
  });
});
