import { findExamLevel, getLevelIdsInScope, normaliseCardWeights } from '../exams';
import { cardRetrievability, projectedRetrievability } from '../srs/scheduler';
import type { Card, CardWithEntry, LexicalEntry, StudyProfile, Timestamp } from '../types/card';
import type { CardKind } from '../types/exam';
import type { ReviewLog } from '../types/review';
import { endOfStudyDay, isDue, startOfStudyDay, studyDayOf, toEpochMs } from '../utils/date';

export interface DailyCounts {
  /** New cards introduced during the current study day. */
  newCards: number;
  /** Review-state cards graded during the current study day. */
  reviews: number;
}

export const EMPTY_DAILY_COUNTS: DailyCounts = { newCards: 0, reviews: 0 };

/**
 * What has already been studied during the current study day.
 *
 * Counts come from the review log rather than a stored counter, so the daily
 * caps stay correct when the learner grades cards on two devices, or from the
 * home-screen widget while the app is not running.
 */
export function countTodaysWork(logs: ReviewLog[], now: Timestamp, dayStartHour = 4): DailyCounts {
  const dayStart = toEpochMs(startOfStudyDay(studyDayOf(now, dayStartHour), dayStartHour));
  let newCards = 0;
  let reviews = 0;

  for (const log of logs) {
    if (toEpochMs(log.reviewedAt) < dayStart) continue;
    if (log.stateBefore === 'new') newCards += 1;
    else if (log.stateBefore === 'review') reviews += 1;
  }

  return { newCards, reviews };
}

export interface QueueBreakdown {
  /** Learning and relearning cards due now. Always served first. */
  learning: number;
  /** Review-state cards that are due. */
  due: number;
  /** New cards available within today's remaining allowance. */
  fresh: number;
  /** Review cards past due but held back by the daily cap. */
  heldByCap: number;
  /** Cards suspended or buried, excluded entirely. */
  excluded: number;
  total: number;
}

export interface StudyQueue {
  cards: CardWithEntry[];
  breakdown: QueueBreakdown;
  /** Kind mix of the queue, for showing "this session mirrors your exam paper". */
  kindMix: Partial<Record<CardKind, number>>;
  /** When the next card comes due, if nothing is due right now. */
  nextDueAt?: Timestamp;
}

/**
 * What kind of session this is.
 *
 * Only three, because a mode is a promise about what the scheduler will do and
 * three is all this app can honestly keep. Filtering by card kind is orthogonal
 * and lives in `kinds` — "listening drill" is not a fourth mode, it is a cram
 * session narrowed to one kind.
 */
export type StudyMode =
  /** What is actually due, under the daily caps. The default, and the honest one. */
  | 'due'
  /** New cards only. For deliberately taking on vocabulary rather than maintaining it. */
  | 'learn'
  /**
   * Everything in scope, weakest first, due or not, caps ignored.
   *
   * For the week before an exam, and genuinely a trade: grading a card that was
   * not due still moves its schedule, so cramming buys recall now at the cost of
   * a less well-spaced next interval.
   */
  | 'cram';

/** Every mode, for validating a mode that arrived from a link or stored state. */
export const STUDY_MODES: StudyMode[] = ['due', 'learn', 'cram'];

export interface BuildQueueOptions {
  now: Timestamp;
  profile: StudyProfile;
  cards: Card[];
  entries: LexicalEntry[] | Map<string, LexicalEntry>;
  /** Work already done today; pass `countTodaysWork(...)`. */
  done?: DailyCounts;
  /** Cap on queue length, for a "quick session" of a fixed size. */
  sessionLimit?: number;
  /** Defaults to `'due'`. */
  mode?: StudyMode;
  /** Restrict to these card kinds, for drilling one skill. */
  kinds?: CardKind[];
}

/**
 * Build the queue for a study session.
 *
 * Three rules, in order of precedence:
 *
 *  1. Learning and relearning cards that are due go first. They are on
 *     minute-scale intervals and delaying them wastes the step ladder.
 *  2. Reviews are ordered by how close to forgotten they are, not by due date.
 *     A card at 60% recall is more urgent than one at 89% that happens to have
 *     been due longer, and with an exam booked the ordering switches to
 *     projected recall *on exam day* — which is the thing being optimised.
 *  3. New and review cards are then interleaved so the kind mix approximates
 *     the exam level's weights, so a TOPIK II session is writing-heavy and a
 *     JLPT session is reading-heavy without the learner configuring anything.
 */
export function buildStudyQueue(options: BuildQueueOptions): StudyQueue {
  const { now, profile, cards } = options;
  const mode = options.mode ?? 'due';
  const kindFilter = options.kinds && options.kinds.length > 0 ? new Set(options.kinds) : undefined;
  const done = options.done ?? EMPTY_DAILY_COUNTS;
  const entriesById = toEntryMap(options.entries);
  const scope = new Set(getLevelIdsInScope(profile.targetLevelId));

  const level = findExamLevel(profile.targetLevelId);
  const weights = normaliseCardWeights(level?.cardWeights ?? {});

  const learning: CardWithEntry[] = [];
  const due: CardWithEntry[] = [];
  const fresh: CardWithEntry[] = [];
  let excluded = 0;
  let nextDueAtMs = Number.POSITIVE_INFINITY;

  for (const card of cards) {
    if (card.languageCode !== profile.languageCode) continue;
    if (!scope.has(card.levelId)) continue;

    const entry = entriesById.get(card.entryId);
    if (!entry) continue;

    if (card.suspended || (card.buriedUntil && !isDue(card.buriedUntil, now))) {
      excluded += 1;
      continue;
    }

    if (profile.enabledCardKinds && !profile.enabledCardKinds.includes(card.kind)) {
      excluded += 1;
      continue;
    }

    if (kindFilter && !kindFilter.has(card.kind)) {
      excluded += 1;
      continue;
    }

    const pair: CardWithEntry = { card, entry };

    if (card.state === 'new') {
      // A cram session is about shoring up what is already half-known; dropping
      // unseen words into it would be starting from scratch under time pressure.
      if (mode === 'cram') excluded += 1;
      else fresh.push(pair);
      continue;
    }

    if (mode === 'learn') {
      excluded += 1;
      continue;
    }

    if (!isDue(card.due, now)) {
      nextDueAtMs = Math.min(nextDueAtMs, toEpochMs(card.due));
      // Cramming reaches past the due date on purpose. Everything else does not.
      if (mode !== 'cram') continue;
    }

    if (card.state === 'learning' || card.state === 'relearning') learning.push(pair);
    else due.push(pair);
  }

  const urgency = urgencyComparator(now, profile.examDate);
  learning.sort((a, b) => toEpochMs(a.card.due) - toEpochMs(b.card.due));
  due.sort(urgency);
  fresh.sort(newCardComparator);

  // Cramming is an explicit decision to spend the evening on this, so the daily
  // caps — which exist to stop tomorrow being unmanageable — are not applied. The
  // learner has already accepted that trade by choosing the mode.
  const reviewAllowance =
    mode === 'cram' ? due.length : Math.max(0, profile.dailyReviewLimit - done.reviews);
  const newAllowance = Math.max(0, profile.dailyNewLimit - done.newCards);

  const servedReviews = due.slice(0, reviewAllowance);
  const heldByCap = due.length - servedReviews.length;
  const servedNew = fresh.slice(0, newAllowance);

  /**
   * Cards held back by the cap come back at the daily reset, not on their own due
   * date — they are already overdue.
   *
   * Without this the empty state lies in the one case it matters: with the review
   * cap spent, `nextDueAt` would report the next *scheduled* card and the dashboard
   * would say "all caught up, more in 3 days" while a pile of overdue cards waits
   * for tomorrow. The reset is sooner than any of those, so it wins.
   */
  const heldBackReturnAt = heldByCap > 0 || fresh.length > servedNew.length
    ? toEpochMs(endOfStudyDay(now, profile.dayStartHour))
    : Number.POSITIVE_INFINITY;

  const nextAvailableMs = Math.min(nextDueAtMs, heldBackReturnAt);

  // Learning cards bypass the caps: they were already counted when introduced,
  // and stranding a card mid-ladder is worse than a slightly longer session.
  const interleaved = interleaveByKindWeights([...servedReviews, ...servedNew], weights);
  const ordered = [...learning, ...interleaved];
  const limited = options.sessionLimit ? ordered.slice(0, options.sessionLimit) : ordered;

  return {
    cards: limited,
    breakdown: {
      learning: learning.length,
      due: servedReviews.length,
      fresh: servedNew.length,
      heldByCap,
      excluded,
      total: limited.length,
    },
    kindMix: countKinds(limited),
    ...(Number.isFinite(nextAvailableMs) ? { nextDueAt: new Date(nextAvailableMs).toISOString() } : {}),
  };
}

/**
 * Order reviews by risk.
 *
 * With no exam booked, risk is current recall probability — study what is
 * closest to being forgotten. With an exam booked, risk is recall probability
 * *projected to exam day*, which reorders things meaningfully: a card at 95%
 * today but with low stability will be well below a card at 80% with high
 * stability by the time the paper is in front of you.
 */
function urgencyComparator(now: Timestamp, examDate?: string) {
  const horizon = examDate ? `${examDate}T09:00:00.000Z` : undefined;
  return (a: CardWithEntry, b: CardWithEntry): number => {
    const scoreA = horizon ? projectedRetrievability(a.card, horizon) : cardRetrievability(a.card, now);
    const scoreB = horizon ? projectedRetrievability(b.card, horizon) : cardRetrievability(b.card, now);
    if (scoreA !== scoreB) return scoreA - scoreB;
    return toEpochMs(a.card.due) - toEpochMs(b.card.due);
  };
}

/** New cards come in curriculum order: lower level first, then frequency. */
function newCardComparator(a: CardWithEntry, b: CardWithEntry): number {
  const rankA = a.entry.frequencyRank ?? Number.MAX_SAFE_INTEGER;
  const rankB = b.entry.frequencyRank ?? Number.MAX_SAFE_INTEGER;
  if (a.card.levelId !== b.card.levelId) return a.card.levelId.localeCompare(b.card.levelId);
  if (rankA !== rankB) return rankA - rankB;
  return a.card.id.localeCompare(b.card.id);
}

/**
 * Interleave cards so the kind mix tracks the exam's weights.
 *
 * Largest-deficit selection: at each position, serve the kind furthest below its
 * target share of the cards placed so far. Kinds with no cards left are skipped,
 * and the deficit for the rest re-normalises, so a session with no available
 * writing cards degrades to the right mix of what is left rather than refusing
 * to fill.
 */
export function interleaveByKindWeights(
  cards: CardWithEntry[],
  weights: Record<string, number>,
): CardWithEntry[] {
  if (cards.length === 0) return [];

  const pools = new Map<CardKind, CardWithEntry[]>();
  for (const pair of cards) {
    const pool = pools.get(pair.card.kind);
    if (pool) pool.push(pair);
    else pools.set(pair.card.kind, [pair]);
  }

  // No usable weights: keep the order the caller established.
  const usable = [...pools.keys()].filter((kind) => (weights[kind] ?? 0) > 0);
  if (usable.length <= 1) return cards;

  const taken = new Map<CardKind, number>();
  const result: CardWithEntry[] = [];

  while (result.length < cards.length) {
    const available = [...pools.entries()].filter(([, pool]) => pool.length > 0);
    if (available.length === 0) break;

    const totalWeight = available.reduce((sum, [kind]) => sum + (weights[kind] ?? 0.01), 0);
    let best: CardKind | undefined;
    let bestDeficit = Number.NEGATIVE_INFINITY;

    for (const [kind] of available) {
      const target = ((weights[kind] ?? 0.01) / totalWeight) * (result.length + 1);
      const deficit = target - (taken.get(kind) ?? 0);
      if (deficit > bestDeficit) {
        bestDeficit = deficit;
        best = kind;
      }
    }

    const kind = best ?? available[0]![0];
    const pool = pools.get(kind)!;
    result.push(pool.shift()!);
    taken.set(kind, (taken.get(kind) ?? 0) + 1);
  }

  return result;
}

function countKinds(cards: CardWithEntry[]): Partial<Record<CardKind, number>> {
  const counts: Partial<Record<CardKind, number>> = {};
  for (const { card } of cards) {
    counts[card.kind] = (counts[card.kind] ?? 0) + 1;
  }
  return counts;
}

export function toEntryMap(entries: LexicalEntry[] | Map<string, LexicalEntry>): Map<string, LexicalEntry> {
  return entries instanceof Map ? entries : new Map(entries.map((entry) => [entry.id, entry]));
}
