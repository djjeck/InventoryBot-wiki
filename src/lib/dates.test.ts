import { describe, expect, it } from 'vitest';
import {
  formatIso,
  formatWindowsDate,
  isoDateSeconds,
  isTimeZone,
  localNowIso,
  parseWindowsDate,
  wallClockOffset,
  windowsDateSeconds,
} from './dates.ts';

describe('dates', () => {
  it('parseWindowsDate reads only the Windows date title, and checks the date exists', () => {
    expect(windowsDateSeconds('27.11.2025 19:14:19 UTC-05:00')).toBe(1764288859);
    expect(parseWindowsDate('01.11.2025 19:14:19 UTC+05:30')?.offsetMinutes).toBe(330);
    for (const bad of [
      '27.11.2025 19:14:60 UTC-05:00',
      '30.02.2025 01:02:03 UTC+00:00',
      '27.11.2025 24:00:00 UTC+00:00',
      '27.11.2025 19:14:19 UTC+25:00',
      '27.11.2025 19:14:19 UTC-05:00x',
      '27.11.2025 19:14:19 -05:00',
      ' 1.11.2025 19:14:19 UTC-05:00',
      '27.11.2025 19:14:19',
      null,
    ]) {
      expect(parseWindowsDate(bad), String(bad)).toBeNull();
    }
  });

  it('formatWindowsDate writes the parsed date back', () => {
    const d = parseWindowsDate('07.03.2026 05:04:03 UTC-05:00');
    expect(d && formatWindowsDate(d)).toBe('07.03.2026 05:04:03 UTC-05:00');
  });

  it('wallClockOffset follows daylight saving time', () => {
    const at = (month: number, day: number, hour: number) => ({
      year: 2025,
      month,
      day,
      hour,
      minute: 30,
      second: 0,
    });
    const rome = (month: number, day: number, hour: number) =>
      wallClockOffset(at(month, day, hour), 'Europe/Rome');
    expect([rome(11, 28, 19), rome(7, 1, 19)]).toStrictEqual([60, 120]);
    // 30 March: 02:30 never happens (clocks go forward): the offset from before.
    expect(rome(3, 30, 2)).toBe(60);
    expect(rome(3, 30, 4)).toBe(120); // hours after the change: the new offset
    // 26 October: 02:30 happens twice (clocks go back): the first one.
    expect([rome(10, 26, 2), rome(10, 26, 3)]).toStrictEqual([120, 60]);
    expect(wallClockOffset(at(11, 28, 0), 'Asia/Kolkata')).toBe(330);
    expect(wallClockOffset(at(11, 28, 0), 'UTC')).toBe(0);
  });

  it('isTimeZone knows IANA zones only', () => {
    expect(['Europe/Rome', 'UTC', 'America/New_York'].map(isTimeZone)).toStrictEqual([
      true,
      true,
      true,
    ]);
    expect(['Mars/Base', 'Italia'].map(isTimeZone)).toStrictEqual([false, false]);
  });

  it('formatIso writes the parsed date in ISO 8601', () => {
    const d = parseWindowsDate('07.03.2026 05:04:03 UTC-05:00');
    expect(d && formatIso(d)).toBe('2026-03-07T05:04:03-05:00');
    expect(
      formatIso({ year: 2026, month: 1, day: 2, hour: 3, minute: 4, second: 5, offsetMinutes: 0 })
    ).toBe('2026-01-02T03:04:05+00:00');
  });

  it('isoDateSeconds compares instants across offsets', () => {
    expect(isoDateSeconds('2025-11-28T01:00:00+00:00')).toBe(Date.UTC(2025, 10, 28, 1) / 1000);
    expect(isoDateSeconds('2025-11-27T20:00:00-05:00')).toBe(Date.UTC(2025, 10, 28, 1) / 1000);
    expect(isoDateSeconds('2025-11-27T19:00:00Z')).toBeNull();
    expect(isoDateSeconds('garbage')).toBeNull();
    expect(isoDateSeconds(null)).toBeNull();
  });

  it('localNowIso is the local time with its offset', () => {
    const now = new Date(Date.UTC(2026, 0, 2, 3, 4, 5));
    expect(isoDateSeconds(localNowIso(now))).toBe(now.getTime() / 1000);
  });
});
