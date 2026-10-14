import { cardRetrievability } from '../srs/scheduler';
import type { Card, DateOnly, Timestamp } from '../types/card';
import type { CardKind } from '../types/exam';
import type { ReviewLog } from '../types/review';
import { addDays, studyDayOf, toDateOnly, toEpochMs } from '../utils/date';
import { parseCardId } from '../utils/id';

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

export interface CoverageStats {
  /** Distinct entries with at least one card out of the new state. */
  entriesStarted: number;
  /**
   * Distinct entries where every generated card is in review with a stability
   * of a week or more. The bar for calling a word "known" rather than "seen".
   */
  entriesKnown: number;
  /** Cumulative vocabulary the exam level expects. */
  target: number;
  /** entriesKnown / target, capped at 1. */
  fraction: number;
  newCards: number;
  learningCards: number;
  reviewCards: number;
  leeches: number;
}

const KNOWN_STABILITY_DAYS = 7;

export function computeCoverage(cards: Card[], vocabularyTarget: number): CoverageStats {
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

  return {
    entriesStarted,
    entriesKnown,
    target: vocabularyTarget,
    fraction: vocabularyTarget > 0 ? Math.min(1, entriesKnown / vocabularyTarget) : 0,
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

/**
 * Retention per card kind.
 *
 * One overall retention figure hides the thing a learner can act on. Somebody
 * sitting at 88% is usually not 88% at everything — they are comfortable
 * recognising a word and losing its tones, or reading it and unable to produce
 * it. Those need different practice, and the single number says only "revise
 * more".
 *
 * Reported weakest first, because the list is read to find what to fix.
 */
export interface KindRetention {
  kind: CardKind;
  /** Gradings of review-state cards of this kind in the window. */
  reviews: number;
  /** Share of those the learner recalled. */
  trueRetention: number;
}

export function computeRetentionByKind(
  logs: ReviewLog[],
  options: { windowDays?: number; now?: Timestamp; minimumReviews?: number } = {},
): KindRetention[] {
  const windowDays = options.windowDays ?? 30;
  /*
   * A floor on the sample, or the weakest skill is whichever one was attempted
   * twice and missed once. Three reviews can say 33% and mean nothing, and a
   * learner acting on it would drill the wrong thing.
   */
  const minimumReviews = options.minimumReviews ?? 5;
  const cutoff = options.now ? toEpochMs(addDays(options.now, -windowDays)) : 0;

  const byKind = new Map<CardKind, { reviews: number; recalled: number }>();

  for (const log of logs) {
    // Learning-state gradings are excluded for the same reason true retention
    // excludes them: a card still in its first ladder has not been remembered
    // over an interval yet, so counting it flatters the figure.
    if (log.stateBefore !== 'review') continue;
    if (toEpochMs(log.reviewedAt) < cutoff) continue;

    let kind: CardKind;
    try {
      kind = parseCardId(log.cardId).kind;
    } catch {
      // A log whose card id predates the current scheme tells us nothing about
      // which skill it exercised, and guessing would put it in the wrong bucket.
      continue;
    }

    const tally = byKind.get(kind) ?? { reviews: 0, recalled: 0 };
    tally.reviews += 1;
    if (log.rating > 1) tally.recalled += 1;
    byKind.set(kind, tally);
  }

  return [...byKind.entries()]
    .filter(([, tally]) => tally.reviews >= minimumReviews)
    .map(([kind, tally]) => ({
      kind,
      reviews: tally.reviews,
      trueRetention: tally.recalled / tally.reviews,
    }))
    .sort((a, b) => a.trueRetention - b.trueRetention || a.kind.localeCompare(b.kind));
}
