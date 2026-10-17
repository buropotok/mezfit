import { clamp, smooth } from './liquidPopoverCanvas';
import { createLiquidMotion, LIQUID_POPOVER_DEFAULTS, type LiquidRect, type Point } from './liquidPopoverGeometry';

export type SpeechCloudArea = { left: number; top: number; width: number; height: number };
export const SPEECH_CLOUD_DEFAULTS = Object.freeze({
  maxWidth: 300,
  durationMs: 400,
  tailDurationMs: 250,
  tailDelayMs: 200,
  tailBend: 12,
});

/** 72% leaves the text rectangle's corners inside the final superellipse. */
export const SPEECH_CLOUD_TEXT_RATIO = 0.72;

/** Pure placement in viewport coordinates. Reserve the avatar's maximum pulse. */
export function placeSpeechCloud(source: LiquidRect, width: number, height: number, area: SpeechCloudArea): LiquidRect {
  const right = area.left + area.width, bottom = area.top + area.height;
  const gapX = source.w * .75 + 16, gapY = source.h * .75 + 16;
  const regions: SpeechCloudArea[] = [
    { ...area, top: Math.max(area.top, source.y + gapY), height: bottom - Math.max(area.top, source.y + gapY) },
    { ...area, height: Math.min(bottom, source.y - gapY) - area.top },
    { ...area, left: Math.max(area.left, source.x + gapX), width: right - Math.max(area.left, source.x + gapX) },
    { ...area, width: Math.min(right, source.x - gapX) - area.left },
  ];
  const candidates = regions.flatMap((region, index) => {
    if (region.width < 32 || region.height < 32) return [];
    const w = Math.min(width, region.width), h = Math.min(height, region.height);
    const x = index === 2 ? region.left + w / 2 : index === 3 ? region.left + region.width - w / 2
      : clamp(source.x, region.left + w / 2, region.left + region.width - w / 2);
    const y = index === 0 ? region.top + h / 2 : index === 1 ? region.top + region.height - h / 2
      : clamp(source.y, region.top + h / 2, region.top + region.height - h / 2);
    return [{ x, y, w, h, score: (width * height - w * h) * 100 + Math.hypot(x - source.x, y - source.y) + index * .01 }];
  });
  if (!candidates.length) return { x: area.left + area.width / 2, y: area.top + area.height / 2,
    w: Math.min(width, area.width), h: Math.min(height, area.height) };
  const best = candidates.reduce((a, b) => a.score <= b.score ? a : b);
  return { x: best.x, y: best.y, w: best.w, h: best.h };
}

/** Retain Liquid Popover's moving shell, with the superellipse as the endpoint. */
export function createSpeechCloudMotion(source: LiquidRect, rect: LiquidRect) {
  const probe = createLiquidMotion(source, rect, LIQUID_POPOVER_DEFAULTS);
  const scale = probe.geometry(probe.morphStart).a / (rect.w / 2);
  return createLiquidMotion(source, { ...rect, w: rect.w / scale, h: rect.h / scale }, LIQUID_POPOVER_DEFAULTS);
}

export function nearestSpeechCloudPoint(loops: readonly (readonly Point[])[], point: Point): Point | null {
  let nearest: Point | null = null, distance = Infinity;
  for (const loop of loops) for (let i = 0; i < loop.length; i++) {
    const a = loop[i], b = loop[(i + 1) % loop.length];
    const dx = b.x - a.x, dy = b.y - a.y;
    const t = clamp(((point.x - a.x) * dx + (point.y - a.y) * dy) / (dx * dx + dy * dy || 1));
    const x = a.x + dx * t, y = a.y + dy * t;
    const squared = (point.x - x) ** 2 + (point.y - y) ** 2;
    if (squared < distance) { distance = squared; nearest = { x, y }; }
  }
  return nearest;
}

/** Freeze the bend side for a motion session; symmetric cases bend clockwise. */
export function speechCloudBendSide(loops: Point[][], source: Point, center: Point): number {
  const near = nearestSpeechCloudPoint(loops, source);
  if (!near) return 1;
  const dx = source.x - near.x, dy = source.y - near.y, length = Math.hypot(dx, dy) || 1;
  const dot = -dy / length * (near.x - center.x) + dx / length * (near.y - center.y);
  return Math.abs(dot) < .01 ? 1 : Math.sign(dot);
}

/** Taper a quadratic spine into one curved triangle, overlapping the body. */
export function speechCloudTail(loops: Point[][], source: LiquidRect, progress: number, bend: number, side: number): Point[][] {
  if (progress <= 0) return [];
  const near = nearestSpeechCloudPoint(loops, source);
  if (!near) return [];
  const dx = source.x - near.x, dy = source.y - near.y, length = Math.hypot(dx, dy);
  const ux = dx / (length || 1), uy = dy / (length || 1);
  const radius = 1 / Math.hypot(ux / (source.w / 2), uy / (source.h / 2));
  if (length <= radius + 3) return [];
  const k = smooth(progress), base = { x: near.x - ux * 10, y: near.y - uy * 10 };
  const tip = { x: near.x + ux * (length - radius - 3) * k, y: near.y + uy * (length - radius - 3) * k };
  const sag = Math.min(bend, Math.hypot(tip.x - base.x, tip.y - base.y) * .3) * k;
  const control = { x: (base.x + tip.x) / 2 - uy * side * 2 * sag, y: (base.y + tip.y) / 2 + ux * side * 2 * sag };
  const first: Point[] = [], second: Point[] = [];
  for (let i = 0; i <= 32; i++) {
    const t = i / 32, v = 1 - t;
    const x = v * v * base.x + 2 * v * t * control.x + t * t * tip.x;
    const y = v * v * base.y + 2 * v * t * control.y + t * t * tip.y;
    const tx = 2 * v * (control.x - base.x) + 2 * t * (tip.x - control.x);
    const ty = 2 * v * (control.y - base.y) + 2 * t * (tip.y - control.y);
    const norm = Math.hypot(tx, ty) || 1, half = 12 * k * (1 - t);
    first.push({ x: x - ty / norm * half, y: y + tx / norm * half });
    second.push({ x: x + ty / norm * half, y: y - tx / norm * half });
  }
  return [first.concat(second.reverse())];
}

/** Opening pulse: 100ms up, 200ms hold, 100ms down. */
export function speechCloudAvatarScale(elapsedMs: number): number {
  if (elapsedMs < 100) return 1 + .5 * smooth(elapsedMs / 100);
  if (elapsedMs < 300) return 1.5;
  return 1.5 - .5 * smooth((elapsedMs - 300) / 100);
}

/** Exact circular/elliptical aperture around the currently transformed avatar. */
export function speechCloudDimPath(width: number, height: number, avatar: LiquidRect): string {
  const rx = avatar.w / 2, ry = avatar.h / 2;
  return `M0 0H${width}V${height}H0Z M${avatar.x - rx} ${avatar.y}a${rx} ${ry} 0 1 0 ${rx * 2} 0a${rx} ${ry} 0 1 0 ${-rx * 2} 0Z`;
}
