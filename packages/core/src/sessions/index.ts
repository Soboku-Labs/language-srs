import type { Timestamp } from '../types/card';
import type { LanguageCode } from '../types/language';
import type { Rating, ReviewLog } from '../types/review';
import { MS_PER_DAY, startOfStudyDay, studyDayOf } from '../utils/date';

/**
 * A sitting.
 *
 * The app already kept every grading in `ReviewLog`, which is what the scheduler
 * and the retention maths need — but it is the wrong grain for a person. Nobody
 * asks "how many gradings did I make on Tuesday"; they ask how long they sat
 * down for, how often, and whether they are still doing it. That is a session,
 * and it needs a start, an end and a shape.
 *
 * Recorded rather than inferred, because only the app knows when a sitting was
 * abandoned versus finished. `groupLogsIntoSessions` exists as a fallback for
 * history recorded before sessions were, and for gradings made on the widget
 * where there is no app session to belong to.
 */
export interface StudySessionRecord {
  id: string;
  languageCode: LanguageCode;
  startedAt: Timestamp;
  endedAt: Timestamp;
  /** Cards graded in this sitting. */
  reviewed: number;
  /** Of those, how many were recalled — anything above Again. */
  recalled: number;
  /** Time cards were actually on screen, which is less than end minus start. */
  activeMs: number;
  /** Where it happened, so an account's history reads across devices. */
  device?: string;
  /** Reconstructed from review logs rather than recorded live. */
  derived?: boolean;
}

/** A sitting in progress. Immutable, so React state can hold it directly. */
export interface StudySessionDraft {
  id: string;
  languageCode: LanguageCode;
  startedAt: Timestamp;
  reviewed: number;
  recalled: number;
  activeMs: number;
  device?: string;
}

export function startStudySession(options: {
  languageCode: LanguageCode;
  now: Timestamp;
  id: string;
  device?: string;
}): StudySessionDraft {
  return {
    id: options.id,
    languageCode: options.languageCode,
    startedAt: options.now,
    reviewed: 0,
    recalled: 0,
    activeMs: 0,
    ...(options.device ? { device: options.device } : {}),
  };
}

/** Fold one grading into a sitting. Returns a new draft; never mutates. */
export function addGradeToSession(
  draft: StudySessionDraft,
  rating: Rating,
  durationMs = 0,
): StudySessionDraft {
  return {
    ...draft,
    reviewed: draft.reviewed + 1,
    recalled: draft.recalled + (rating > 1 ? 1 : 0),
    // A card left on screen while someone answers the door is not study time.
    activeMs: draft.activeMs + Math.min(Math.max(durationMs, 0), MAX_CARD_MS),
  };
}

/**
 * Close a sitting.
 *
 * Returns nothing when no card was graded. Opening the review screen, seeing
 * what is there and backing out is not a study session, and recording it as one
 * would inflate every count on the account screen with zeroes.
 */
export function finishStudySession(draft: StudySessionDraft, now: Timestamp): StudySessionRecord | undefined {
  if (draft.reviewed === 0) return undefined;
  return {
    id: draft.id,
    languageCode: draft.languageCode,
    startedAt: draft.startedAt,
    endedAt: now,
    reviewed: draft.reviewed,
    recalled: draft.recalled,
    activeMs: draft.activeMs,
    ...(draft.device ? { device: draft.device } : {}),
  };
}

/** Cap on how long one card can count for, in milliseconds. */
const MAX_CARD_MS = 120_000;

/** Default gap that separates two sittings when reconstructing from logs. */
export const SESSION_GAP_MINUTES = 15;

/**
 * Reconstruct sittings from review logs.
 *
 * Used for history that predates session recording, and for widget gradings,
 * which happen on the home screen with no session around them. The gap rule is
 * the same one every activity tracker uses: consecutive reviews more than
 * `gapMinutes` apart are two sittings rather than one very long one.
 */
export function groupLogsIntoSessions(
  logs: ReviewLog[],
  options: { gapMinutes?: number; languageOf: (log: ReviewLog) => LanguageCode | undefined } ,
): StudySessionRecord[] {
  const gapMs = (options.gapMinutes ?? SESSION_GAP_MINUTES) * 60_000;
  const ordered = [...logs].sort((a, b) => Date.parse(a.reviewedAt) - Date.parse(b.reviewedAt));

  const sessions: StudySessionRecord[] = [];
  let current: StudySessionRecord | undefined;
  let previousAt = 0;

  for (const log of ordered) {
    const language = options.languageOf(log);
    if (!language) continue;
    const at = Date.parse(log.reviewedAt);

    // A different language is a different sitting even without a gap: switching
    // language switches the whole deck, and merging them would report a session
    // that belongs to neither.
    const continues = current && current.languageCode === language && at - previousAt <= gapMs;

    if (!continues) {
      current = {
        id: `derived:${log.id}`,
        languageCode: language,
        startedAt: log.reviewedAt,
        endedAt: log.reviewedAt,
        reviewed: 0,
        recalled: 0,
        activeMs: 0,
        derived: true,
      };
      sessions.push(current);
    }

    const session = current!;
    session.endedAt = log.reviewedAt;
    session.reviewed += 1;
    if (log.rating > 1) session.recalled += 1;
    session.activeMs += Math.min(Math.max(log.durationMs, 0), MAX_CARD_MS);
    previousAt = at;
  }

  return sessions;
}

export interface SessionDay {
  /** Calendar day in the learner's study-day terms, e.g. "2026-07-31". */
  day: string;
  sessions: number;
  reviewed: number;
  activeMs: number;
}

export interface SessionSummary {
  sessions: number;
  reviewed: number;
  recalled: number;
  /** Recalled over reviewed, or zero when nothing has been reviewed. */
  accuracy: number;
  activeMs: number;
  /** Mean cards per sitting, rounded to one decimal. */
  averageReviewed: number;
  /** The busiest single sitting, by cards. */
  longest?: StudySessionRecord;
  /** Most recent first. */
  recent: StudySessionRecord[];
  /** Oldest first, one entry per day in the window, including empty days. */
  perDay: SessionDay[];
}

/**
 * Summarise sittings for the account and progress screens.
 *
 * Bucketed by *study* day rather than calendar day, so a session that starts at
 * 1am counts towards the day it started in — the same rule the streak uses. Two
 * different definitions of "day" in one app produces a streak of 6 next to a
 * chart with 7 bars, and no way to tell which is lying.
 */
export function summariseSessions(
  records: StudySessionRecord[],
  options: { now: Timestamp; days?: number; dayStartHour?: number; recentLimit?: number } ,
): SessionSummary {
  const days = options.days ?? 14;
  const dayStartHour = options.dayStartHour ?? 4;

  // The window opens at the start of the study day `days - 1` days back, so a
  // 14-day window contains 14 buckets including today rather than 15.
  const today = studyDayOf(options.now, dayStartHour);
  const windowStartMs = Date.parse(startOfStudyDay(today, dayStartHour)) - (days - 1) * MS_PER_DAY;

  const inWindow = records.filter((record) => Date.parse(record.startedAt) >= windowStartMs);
  const byDay = new Map<string, SessionDay>();

  for (let index = 0; index < days; index += 1) {
    const day = studyDayOf(windowStartMs + index * MS_PER_DAY, dayStartHour);
    byDay.set(day, { day, sessions: 0, reviewed: 0, activeMs: 0 });
  }

  let reviewed = 0;
  let recalled = 0;
  let activeMs = 0;
  let longest: StudySessionRecord | undefined;

  for (const record of inWindow) {
    reviewed += record.reviewed;
    recalled += record.recalled;
    activeMs += record.activeMs;
    if (!longest || record.reviewed > longest.reviewed) longest = record;

    const bucket = byDay.get(studyDayOf(record.startedAt, dayStartHour));
    if (bucket) {
      bucket.sessions += 1;
      bucket.reviewed += record.reviewed;
      bucket.activeMs += record.activeMs;
    }
  }

  const recent = [...records]
    .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))
    .slice(0, options.recentLimit ?? 10);

  return {
    sessions: inWindow.length,
    reviewed,
    recalled,
    accuracy: reviewed > 0 ? recalled / reviewed : 0,
    activeMs,
    averageReviewed: inWindow.length > 0 ? Math.round((reviewed / inWindow.length) * 10) / 10 : 0,
    ...(longest ? { longest } : {}),
    recent,
    perDay: [...byDay.values()],
  };
}

/** "12 min", "1h 04m" — a duration as a person would say it. */
export function formatDuration(ms: number): string {
  const totalMinutes = Math.round(ms / 60_000);
  if (totalMinutes < 1) return 'under a minute';
  if (totalMinutes < 60) return `${totalMinutes} min`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}h ${String(minutes).padStart(2, '0')}m`;
}
