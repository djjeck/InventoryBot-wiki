import { describe, expect, it } from 'vitest';
import { formatWindowsDate, parseOffset, parseWindowsDate, windowsDateSeconds } from './dates.ts';

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

  it('parseOffset reads ±HH:MM', () => {
    expect(parseOffset('-05:00')).toBe(-300);
    expect(parseOffset('+05:45')).toBe(345);
    for (const bad of ['05:00', '+5:00', '+24:00', '+01:60', 'UTC+01:00'])
      expect(parseOffset(bad)).toBeNull();
  });
});
