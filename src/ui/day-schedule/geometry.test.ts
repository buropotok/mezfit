import { describe, expect, it } from 'vitest';
import { EVENT_EDGE_INSET, HOUR_HEIGHT, START_HOUR, eventFitsSlot, eventGeometry, resizedEventTiming, startMinutesAfterDrag, yForMinutes } from './DayPanel';
import { addDays, dayIndex, startOfWeek } from './dateMath';

describe('schedule geometry and date boundaries', () => {
  it('uses the compact 64px hour scale with symmetric 1px card insets', () => {
    expect(START_HOUR).toBe(0);
    expect(HOUR_HEIGHT).toBe(64);
    expect(EVENT_EDGE_INSET).toBe(1);
    expect(eventGeometry({ id: 'hour', startMinutes: 600, durationMinutes: 60 })).toEqual({
      top: yForMinutes(600) + 1,
      height: 62,
    });
  });

  it('keeps adjacent short events within their actual intervals', () => {
    const a = eventGeometry({ id: 'a', startMinutes: 600, durationMinutes: 15 });
    const b = eventGeometry({ id: 'b', startMinutes: 615, durationMinutes: 15 });
    expect(a).not.toBeNull(); expect(b).not.toBeNull();
    expect(a!.top + a!.height).toBeLessThan(b!.top);
  });
  it('renders early-morning events, clips at day boundaries, and ignores invalid geometry', () => {
    expect(eventGeometry({ id: 'early', startMinutes: 300, durationMinutes: 30 })).toEqual({
      top: yForMinutes(300) + 1,
      height: 30,
    });
    expect(eventGeometry({ id: 'before-day', startMinutes: -60, durationMinutes: 30 })).toBeNull();
    const midnightCrossing = eventGeometry({ id: 'midnight-crossing', startMinutes: -30, durationMinutes: 60 });
    expect(midnightCrossing).toEqual({ top: 1, height: 30 });
    const crossing = eventGeometry({ id: 'a', startMinutes: 1430, durationMinutes: 60 });
    expect(crossing!.top + crossing!.height).toBeLessThanOrEqual(yForMinutes(1440));
    expect(eventGeometry({ id: 'a', startMinutes: NaN, durationMinutes: 30 })).toBeNull();
    expect(eventGeometry({ id: 'a', startMinutes: 600, durationMinutes: -1 })).toBeNull();
  });
  it('snaps vertical event dragging to quarter-hour start times', () => {
    expect(startMinutesAfterDrag(600, 60, 20)).toBe(615);
    expect(startMinutesAfterDrag(607, 60, 12)).toBe(615);
    expect(startMinutesAfterDrag(607, 60, 28)).toBe(630);
    expect(startMinutesAfterDrag(600, 60, -1000)).toBe(0);
    expect(startMinutesAfterDrag(1380, 60, 1000)).toBe(1380);
  });

  it('does not reverse boundary-crossing events when the drag cannot continue outward', () => {
    expect(startMinutesAfterDrag(1430, 60, 0)).toBe(1430);
    expect(startMinutesAfterDrag(1430, 60, 40)).toBe(1430);
    expect(startMinutesAfterDrag(1430, 60, -40)).toBe(1395);
    expect(startMinutesAfterDrag(0, 60, 0)).toBe(0);
    expect(startMinutesAfterDrag(0, 60, -24)).toBe(0);
    expect(startMinutesAfterDrag(0, 60, 24)).toBe(30);
  });

  it('keeps the bottom drag boundary on the quarter-hour grid', () => {
    expect(startMinutesAfterDrag(600, 50, 5000)).toBe(1380);
  });

  it('rejects moved events that overlap another event slot', () => {
    const items = [
      { id: 'a', startMinutes: 600, durationMinutes: 60 },
      { id: 'b', startMinutes: 690, durationMinutes: 60 },
    ];
    expect(eventFitsSlot(items, 'a', 645, 60)).toBe(false);
    expect(eventFitsSlot(items, 'a', 630, 60)).toBe(true);
  });

  it('resizes against adjacent events on the 15-minute grid', () => {
    const items = [
      { id: 'a', startMinutes: 600, durationMinutes: 60 },
      { id: 'b', startMinutes: 690, durationMinutes: 60 },
    ];
    expect(resizedEventTiming(items[0], 'end', 32, items)).toEqual({
      startMinutes: 600,
      durationMinutes: 90,
    });
    expect(resizedEventTiming(items[1], 'start', -32, items)).toEqual({
      startMinutes: 660,
      durationMinutes: 90,
    });
  });

  it('pages across month, year and leap-day boundaries without local timezone shifts', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2028-03-01', -1)).toBe('2028-02-29');
    expect(startOfWeek('2026-10-04')).toBe('2026-09-28');
    expect(dayIndex('2026-10-05')).toBe(0);
  });
});
