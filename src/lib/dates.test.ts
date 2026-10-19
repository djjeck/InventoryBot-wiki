import { describe, expect, it } from 'vitest';
import {
  formatWindowsDate,
  isTimeZone,
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
});
