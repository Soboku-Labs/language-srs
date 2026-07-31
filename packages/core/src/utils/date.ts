import type { DateOnly, Timestamp } from '../types/card';

export const MS_PER_MINUTE = 60_000;
export const MS_PER_DAY = 86_400_000;

/**
 * A clock, injected rather than read from the global.
 *
 * Every scheduling decision in this package takes the current time as an
 * argument. That keeps the scheduler pure and testable — "what happens if this
 * card is answered 40 days late" is a function call rather than a mocked
 * global — and it lets the widget compute a payload for a future instant.
 */
export type Clock = () => Timestamp;

export const systemClock: Clock = () => new Date().toISOString();

/** A clock frozen at an instant, for tests and previews. */
export function fixedClock(at: Timestamp | Date): Clock {
  const iso = typeof at === 'string' ? at : at.toISOString();
  return () => iso;
}

export function toTimestamp(value: Date | Timestamp | number): Timestamp {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return new Date(value).toISOString();
  return value.toISOString();
}

export function toEpochMs(value: Timestamp | Date | number): number {
  if (typeof value === 'number') return value;
  if (value instanceof Date) return value.getTime();
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) throw new Error(`Invalid timestamp: ${value}`);
  return ms;
}

export function addMinutes(at: Timestamp, minutes: number): Timestamp {
  return new Date(toEpochMs(at) + minutes * MS_PER_MINUTE).toISOString();
}

export function addDays(at: Timestamp, days: number): Timestamp {
  return new Date(toEpochMs(at) + days * MS_PER_DAY).toISOString();
}

/** Fractional days from `from` to `to`; negative when `to` precedes `from`. */
export function daysBetween(from: Timestamp | Date | number, to: Timestamp | Date | number): number {
  return (toEpochMs(to) - toEpochMs(from)) / MS_PER_DAY;
}

/** Whole days between two calendar dates, ignoring time of day. */
export function calendarDaysBetween(from: DateOnly | Timestamp, to: DateOnly | Timestamp): number {
  return Math.round((toEpochMs(startOfUtcDay(to)) - toEpochMs(startOfUtcDay(from))) / MS_PER_DAY);
}

function startOfUtcDay(value: DateOnly | Timestamp): Timestamp {
  const date = new Date(toEpochMs(normaliseDateInput(value)));
  date.setUTCHours(0, 0, 0, 0);
  return date.toISOString();
}

function normaliseDateInput(value: string): Timestamp {
  // "2026-03-14" parses as UTC midnight, which is what we want.
  return value.length === 10 ? `${value}T00:00:00.000Z` : value;
}

export function toDateOnly(at: Timestamp | Date | number): DateOnly {
  return new Date(toEpochMs(at)).toISOString().slice(0, 10);
}

/**
 * The study day an instant falls in, honouring a day that rolls over at
 * `dayStartHour` rather than midnight.
 *
 * A learner finishing a session at 01:30 expects it to count towards the
 * previous day's streak, not to have silently broken it and started a new one.
 * With the default 4am rollover, anything before 04:00 belongs to the day
 * before.
 */
export function studyDayOf(at: Timestamp | Date | number, dayStartHour = 4): DateOnly {
  const shifted = toEpochMs(at) - dayStartHour * 60 * MS_PER_MINUTE;
  return toDateOnly(shifted);
}

/** The instant a given study day begins. */
export function startOfStudyDay(day: DateOnly, dayStartHour = 4): Timestamp {
  return new Date(toEpochMs(`${day}T00:00:00.000Z`) + dayStartHour * 60 * MS_PER_MINUTE).toISOString();
}

/** The instant the study day containing `at` ends. */
export function endOfStudyDay(at: Timestamp, dayStartHour = 4): Timestamp {
  const day = studyDayOf(at, dayStartHour);
  return addDays(startOfStudyDay(day, dayStartHour), 1);
}

export function isDue(due: Timestamp, now: Timestamp): boolean {
  return toEpochMs(due) <= toEpochMs(now);
}

export function minTimestamp(a: Timestamp, b: Timestamp): Timestamp {
  return toEpochMs(a) <= toEpochMs(b) ? a : b;
}

export function maxTimestamp(a: Timestamp, b: Timestamp): Timestamp {
  return toEpochMs(a) >= toEpochMs(b) ? a : b;
}

/** Human-readable interval for card buttons and the widget, e.g. "10m", "3d", "1.4y". */
export function formatInterval(days: number): string {
  if (days < 1 / 24 / 60) return '<1m';
  if (days < 1 / 24) return `${Math.round(days * 24 * 60)}m`;
  if (days < 1) return `${Math.round(days * 24)}h`;
  if (days < 30) return `${Math.round(days)}d`;
  if (days < 365) return `${(days / 30).toFixed(days < 90 ? 1 : 0)}mo`;
  return `${(days / 365).toFixed(1)}y`;
}
