/**
 * Dates: the two Telegram date-title formats. Pure functions, no Node APIs.
 *
 * - Windows export: `27.11.2025 19:14:19 UTC-05:00` (docs/telegram-export.md §5.1).
 * - macOS export: `27 November 2025, 19:14:19`, without an offset (§11.3).
 *
 * A date is a wall clock plus a UTC offset in minutes; dates are compared as instants
 * (epoch seconds), so the same moment written with different offsets is equal. Any
 * other text, or a day that does not exist, is not a date (null).
 */

/** A wall-clock time without a UTC offset. */
export interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

/** A wall clock with its UTC offset, in minutes east of UTC. */
export interface ZonedDate extends WallClock {
  offsetMinutes: number;
}

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

const WINDOWS_DATE =
  /^([0-9]{2})\.([0-9]{2})\.([0-9]{4}) ([0-9]{2}):([0-9]{2}):([0-9]{2}) UTC([+-])([0-9]{2}):([0-9]{2})$/;
const MAC_DATE = new RegExp(
  `^([0-9]{1,2}) (${MONTHS.join('|')}) ([0-9]{4}), ([0-9]{2}):([0-9]{2}):([0-9]{2})$`
);
const OFFSET = /^([+-])([0-9]{2}):([0-9]{2})$/;

/** Epoch seconds of a wall clock read as UTC, or null if the date or time does not exist. */
function utcSeconds(w: WallClock): number | null {
  const d = new Date(0);
  d.setUTCFullYear(w.year, w.month - 1, w.day);
  d.setUTCHours(w.hour, w.minute, w.second);
  const exists =
    d.getUTCFullYear() === w.year &&
    d.getUTCMonth() === w.month - 1 &&
    d.getUTCDate() === w.day &&
    d.getUTCHours() === w.hour &&
    d.getUTCMinutes() === w.minute &&
    d.getUTCSeconds() === w.second;
  return exists ? d.getTime() / 1000 : null;
}

/** Minutes east of UTC of `±HH:MM` parts (hours 00-23, minutes 00-59), or null. */
function offsetMinutes(sign: string, hh: string, mm: string): number | null {
  const h = Number(hh);
  const m = Number(mm);
  if (h > 23 || m > 59) return null;
  return (sign === '-' ? -1 : 1) * (h * 60 + m);
}

/** A Windows export date title (`27.11.2025 19:14:19 UTC-05:00`), or null. */
export function parseWindowsDate(s: string | null | undefined): ZonedDate | null {
  const m = typeof s === 'string' ? WINDOWS_DATE.exec(s) : null;
  if (!m) return null;
  const [day, month, year, h, mi, sec, sign, oh, om] = m.slice(1) as string[];
  const w = {
    year: Number(year),
    month: Number(month),
    day: Number(day),
    hour: Number(h),
    minute: Number(mi),
    second: Number(sec),
  };
  const off = offsetMinutes(sign as string, oh as string, om as string);
  return off === null || utcSeconds(w) === null ? null : { ...w, offsetMinutes: off };
}

/** A macOS export date title (`27 November 2025, 19:14:19`: English month, 24-hour clock), or null. */
export function parseMacDate(s: string | null | undefined): WallClock | null {
  const m = typeof s === 'string' ? MAC_DATE.exec(s) : null;
  if (!m) return null;
  const w = {
    year: Number(m[3]),
    month: MONTHS.indexOf(m[2] as (typeof MONTHS)[number]) + 1,
    day: Number(m[1]),
    hour: Number(m[4]),
    minute: Number(m[5]),
    second: Number(m[6]),
  };
  return utcSeconds(w) === null ? null : w;
}

/** Minutes east of UTC of a `±HH:MM` offset (hours 00-23, minutes 00-59), or null. */
export function parseOffset(s: string): number | null {
  const m = OFFSET.exec(s);
  return m ? offsetMinutes(m[1] as string, m[2] as string, m[3] as string) : null;
}

/** Epoch seconds of a date. */
export function epochSeconds(d: ZonedDate): number {
  return (utcSeconds(d) as number) - d.offsetMinutes * 60;
}

const pad = (n: number, width = 2): string => String(n).padStart(width, '0');

/** An offset in minutes as `±HH:MM`. */
export function formatOffset(minutes: number): string {
  const a = Math.abs(minutes);
  return `${minutes < 0 ? '-' : '+'}${pad(Math.floor(a / 60))}:${pad(a % 60)}`;
}

/** A date in the Windows title form: `27.11.2025 19:14:19 UTC-05:00`. */
export function formatWindowsDate(d: ZonedDate): string {
  return (
    `${pad(d.day)}.${pad(d.month)}.${pad(d.year, 4)} ` +
    `${pad(d.hour)}:${pad(d.minute)}:${pad(d.second)} UTC${formatOffset(d.offsetMinutes)}`
  );
}

/** Epoch seconds of a Windows date title, or null if it is not one. */
export function windowsDateSeconds(s: string | null | undefined): number | null {
  const d = parseWindowsDate(s);
  return d === null ? null : epochSeconds(d);
}
