import { cardRetrievability } from '../srs/scheduler';
import type { Card, DateOnly, Timestamp } from '../types/card';
import type { ReviewLog } from '../types/review';
import { addDays, studyDayOf, toDateOnly, toEpochMs } from '../utils/date';

/** Consecutive study days ending today (or yesterday, if today is unstarted). */
export interface StreakInfo {
  /** Current run of consecutive study days. */
  current: number;
  /** Longest run ever. */
  longest: number;
  /** True once at least one card has been graded during the current study day. */
  studiedToday: boolean;
  /** Distinct days with at least one grading. */
  totalDays: number;
  lastStudyDay?: DateOnly;
}

/**
 * Streaks, computed from the review log.
 *
 * A streak survives a day where the learner studied at 1am on the following
 * calendar date, because study days roll over at `dayStartHour` rather than
 * midnight. It also does not break until a day has fully elapsed without
 * study — at 9am with nothing done yet, yesterday's streak still stands.
 */
export function computeStreak(logs: ReviewLog[], now: Timestamp, dayStartHour = 4): StreakInfo {
  if (logs.length === 0) {
    return { current: 0, longest: 0, studiedToday: false, totalDays: 0 };
  }

  const days = [...new Set(logs.map((log) => studyDayOf(log.reviewedAt, dayStartHour)))].sort();
  const today = studyDayOf(now, dayStartHour);
  const yesterday = toDateOnly(addDays(`${today}T12:00:00.000Z`, -1));

  let longest = 1;
  let run = 1;
  for (let index = 1; index < days.length; index += 1) {
    const previous = days[index - 1]!;
    const current = days[index]!;
    const isConsecutive = toDateOnly(addDays(`${previous}T12:00:00.000Z`, 1)) === current;
    run = isConsecutive ? run + 1 : 1;
    longest = Math.max(longest, run);
  }

  const lastDay = days[days.length - 1]!;
  const studiedToday = lastDay === today;
  // The run is live if it reaches today or yesterday; otherwise it has lapsed.
  const current = studiedToday || lastDay === yesterday ? run : 0;

  return { current, longest, studiedToday, totalDays: days.length, lastStudyDay: lastDay };
}

export interface RetentionStats {
  /** Gradings of review-state cards in the window. */
  reviews: number;
  /**
   * Share of those the learner actually recalled — anything but Again.
   *
   * This is "true retention", the number to compare against desired retention.
   * Learning-state gradings are excluded: a card being drilled on a one-minute
   * step has not been retained over an interval, so counting it inflates the
   * figure until it means nothing.
   */
  trueRetention: number;
  /** Mean recall probability the scheduler predicted for those gradings. */
  predictedRetention: number;
  /**
   * Predicted minus actual. Positive means the model is optimistic and
   * intervals are too long; large negative means retention is being bought with
   * more reviews than necessary.
   */
  calibrationGap: number;
  averageSecondsPerCard: number;
}

export function computeRetention(logs: ReviewLog[], windowDays = 30, now?: Timestamp): RetentionStats {
  const cutoff = now ? toEpochMs(addDays(now, -windowDays)) : 0;
  const relevant = logs.filter((log) => log.stateBefore === 'review' && toEpochMs(log.reviewedAt) >= cutoff);

  if (relevant.length === 0) {
    return { reviews: 0, trueRetention: 0, predictedRetention: 0, calibrationGap: 0, averageSecondsPerCard: 0 };
  }

  const recalled = relevant.filter((log) => log.rating > 1).length;
  const predicted = relevant.reduce((sum, log) => sum + log.predictedRetrievability, 0) / relevant.length;
  const actual = recalled / relevant.length;
  const timed = relevant.filter((log) => log.durationMs > 0);

  return {
    reviews: relevant.length,
    trueRetention: actual,
    predictedRetention: predicted,
    calibrationGap: predicted - actual,
    averageSecondsPerCard:
      timed.length > 0 ? timed.reduce((sum, log) => sum + log.durationMs, 0) / timed.length / 1000 : 0,
  };
}

/**
 * Two denominators, kept apart on purpose.
 *
 * The exam expects 500 words at HSK 1. The app's deck holds 27 of them. Dividing
 * by the first was making the app report 5% to a learner who had just mastered
 * every word it contains, and promise "473 words remaining" that do not exist
 * anywhere in it. Dividing only by the second would be the opposite lie — "100%
 * of HSK 1" when the paper asks for eighteen times more.
 *
 * So both are reported and each is used for the question it answers: `fraction`
 * for progress the learner can actually make, `syllabusFraction` for how much of
 * the real exam that represents.
 */
export interface CoverageStats {
  /** Distinct entries with at least one card out of the new state. */
  entriesStarted: number;
  /**
   * Distinct entries where every generated card is in review with a stability
   * of a week or more. The bar for calling a word "known" rather than "seen".
   */
  entriesKnown: number;
  /** Words the deck actually holds in the current level's scope. */
  available: number;
  /** Cumulative vocabulary the exam level expects. A fact about the exam. */
  syllabusTarget: number;
  /** entriesKnown / available — the progress bar that can reach the end. */
  fraction: number;
  /** entriesKnown / syllabusTarget — how much of the real paper that covers. */
  syllabusFraction: number;
  newCards: number;
  learningCards: number;
  reviewCards: number;
  leeches: number;
}

const KNOWN_STABILITY_DAYS = 7;

export interface CoverageTargets {
  /** Entries in scope in the deck. Pass the real count, not an estimate. */
  available: number;
  /** The exam level's cumulative vocabulary target. */
  syllabusTarget?: number;
}

export function computeCoverage(cards: Card[], targets: CoverageTargets): CoverageStats {
  const byEntry = new Map<string, Card[]>();
  let newCards = 0;
  let learningCards = 0;
  let reviewCards = 0;
  let leeches = 0;

  for (const card of cards) {
    const bucket = byEntry.get(card.entryId);
    if (bucket) bucket.push(card);
    else byEntry.set(card.entryId, [card]);

    if (card.state === 'new') newCards += 1;
    else if (card.state === 'review') reviewCards += 1;
    else learningCards += 1;
    if (card.leech) leeches += 1;
  }

  let entriesStarted = 0;
  let entriesKnown = 0;
  for (const group of byEntry.values()) {
    if (group.some((card) => card.state !== 'new')) entriesStarted += 1;
    if (group.every((card) => card.state === 'review' && card.stability >= KNOWN_STABILITY_DAYS)) {
      entriesKnown += 1;
    }
  }

  const syllabusTarget = targets.syllabusTarget ?? 0;

  return {
    entriesStarted,
    entriesKnown,
    available: targets.available,
    syllabusTarget,
    fraction: targets.available > 0 ? Math.min(1, entriesKnown / targets.available) : 0,
    syllabusFraction: syllabusTarget > 0 ? Math.min(1, entriesKnown / syllabusTarget) : 0,
    newCards,
    learningCards,
    reviewCards,
    leeches,
  };
}

export interface ForecastDay {
  day: DateOnly;
  /** Review-state cards falling due that day. */
  due: number;
  /** Cumulative due count from today through that day. */
  cumulative: number;
}

/**
 * Upcoming review load, for the "what am I in for" chart.
 *
 * Counts only cards already in review — new cards are governed by the daily
 * limit and would swamp the shape of the graph.
 */
export function forecastReviews(cards: Card[], now: Timestamp, days = 14, dayStartHour = 4): ForecastDay[] {
  const buckets = new Map<DateOnly, number>();
  for (let offset = 0; offset < days; offset += 1) {
    buckets.set(studyDayOf(addDays(now, offset), dayStartHour), 0);
  }

  for (const card of cards) {
    if (card.state !== 'review' || card.suspended) continue;
    const day = studyDayOf(card.due, dayStartHour);
    const existing = buckets.get(day);
    if (existing !== undefined) buckets.set(day, existing + 1);
    // Overdue cards land in today's bucket rather than being dropped.
    else if (toEpochMs(card.due) < toEpochMs(now)) {
      const today = studyDayOf(now, dayStartHour);
      buckets.set(today, (buckets.get(today) ?? 0) + 1);
    }
  }

  let cumulative = 0;
  return [...buckets.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, due]) => {
      cumulative += due;
      return { day, due, cumulative };
    });
}

/** Mean current recall probability across cards in review. A single "how warm is my memory" number. */
export function meanRetrievability(cards: Card[], now: Timestamp): number {
  const active = cards.filter((card) => card.state === 'review' && !card.suspended);
  if (active.length === 0) return 0;
  return active.reduce((sum, card) => sum + cardRetrievability(card, now), 0) / active.length;
}
