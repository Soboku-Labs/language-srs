import { DEFAULT_SCHEDULER_CONFIG } from '../srs/params';
import type { Card, LexicalEntry, Timestamp } from '../types/card';
import type { ReviewLog } from '../types/review';
import { toEpochMs } from '../utils/date';

/**
 * Triage: the words that are fighting the learner.
 *
 * The scheduler already flags a leech once a card has lapsed enough times, and
 * until now that flag went nowhere — the stats screen could say "3 leeches" and
 * offer nothing to do about them. A count of your worst cards that you cannot
 * act on is worse than no count, because it is a problem reported without a
 * handle.
 *
 * Leeches are also diagnosed too late to be useful on their own. The default
 * threshold is eight lapses; a card that has failed four times out of five is
 * already broken and is six lapses from being mentioned. So this reports the
 * cards heading for leech status as well, and says which of the two it is.
 */

export type StruggleReason =
  /** Past the scheduler's lapse threshold. Flagged, and overdue for attention. */
  | 'leech'
  /** Lapsing repeatedly but not yet flagged. The useful warning. */
  | 'lapsing'
  /** Few lapses, but a poor hit rate across its whole history. */
  | 'failing';

export interface StrugglingCard {
  card: Card;
  entry: LexicalEntry;
  reason: StruggleReason;
  lapses: number;
  /** Gradings of this card in the window considered. */
  reviews: number;
  /** Share of those graded Again. */
  failureRate: number;
  /** Higher is worse. Orders the list; not meaningful on its own. */
  severity: number;
}

export interface FindStrugglingOptions {
  cards: Card[];
  entries: LexicalEntry[] | Map<string, LexicalEntry>;
  logs: ReviewLog[];
  /** Lapses before the scheduler flags a leech. Defaults to the shipped config. */
  leechThreshold?: number;
  /**
   * Gradings a card needs before its failure rate is trusted.
   *
   * Without this, one Again on a brand-new card reads as a 100% failure rate and
   * the list fills with words the learner has barely met.
   */
  minimumReviews?: number;
  /** Failure rate at or above which a card counts as failing. */
  failureRateThreshold?: number;
  /** Only consider gradings at or after this instant. */
  since?: Timestamp;
  limit?: number;
}

const DEFAULT_MINIMUM_REVIEWS = 3;
const DEFAULT_FAILURE_RATE = 0.5;

export function findStrugglingCards(options: FindStrugglingOptions): StrugglingCard[] {
  const leechThreshold = options.leechThreshold ?? DEFAULT_SCHEDULER_CONFIG.leechThreshold;
  const minimumReviews = options.minimumReviews ?? DEFAULT_MINIMUM_REVIEWS;
  const failureRateThreshold = options.failureRateThreshold ?? DEFAULT_FAILURE_RATE;
  const cutoff = options.since ? toEpochMs(options.since) : undefined;

  const entriesById =
    options.entries instanceof Map
      ? options.entries
      : new Map(options.entries.map((entry) => [entry.id, entry]));

  const byCard = new Map<string, { reviews: number; failures: number }>();
  for (const log of options.logs) {
    if (cutoff !== undefined && toEpochMs(log.reviewedAt) < cutoff) continue;
    const tally = byCard.get(log.cardId) ?? { reviews: 0, failures: 0 };
    tally.reviews += 1;
    if (log.rating === 1) tally.failures += 1;
    byCard.set(log.cardId, tally);
  }

  const struggling: StrugglingCard[] = [];

  for (const card of options.cards) {
    // A suspended card is already out of rotation: the learner has dealt with it,
    // and listing it again as a problem would be nagging about a settled decision.
    if (card.suspended) continue;

    const entry = entriesById.get(card.entryId);
    if (!entry) continue;

    const tally = byCard.get(card.id) ?? { reviews: 0, failures: 0 };
    const failureRate = tally.reviews > 0 ? tally.failures / tally.reviews : 0;

    const reason = classify({
      card,
      lapses: card.lapses,
      reviews: tally.reviews,
      failureRate,
      leechThreshold,
      minimumReviews,
      failureRateThreshold,
    });
    if (!reason) continue;

    struggling.push({
      card,
      entry,
      reason,
      lapses: card.lapses,
      reviews: tally.reviews,
      failureRate,
      // Lapses dominate, because a lapse is a word that was learned and lost,
      // which is the expensive failure. The failure rate breaks ties.
      severity: card.lapses * 2 + failureRate,
    });
  }

  struggling.sort((a, b) => b.severity - a.severity || a.card.id.localeCompare(b.card.id));
  return options.limit !== undefined ? struggling.slice(0, options.limit) : struggling;
}

function classify(input: {
  card: Card;
  lapses: number;
  reviews: number;
  failureRate: number;
  leechThreshold: number;
  minimumReviews: number;
  failureRateThreshold: number;
}): StruggleReason | undefined {
  if (input.card.leech || input.lapses >= input.leechThreshold) return 'leech';

  // Half the threshold is the point where a card is clearly not sticking but is
  // still cheap to fix — early enough that rewording it saves the remaining
  // lapses rather than being an obituary.
  if (input.lapses >= Math.ceil(input.leechThreshold / 2)) return 'lapsing';

  if (input.reviews >= input.minimumReviews && input.failureRate >= input.failureRateThreshold) {
    return 'failing';
  }

  return undefined;
}

/** One line saying what is wrong with this card, for the UI. */
export function describeStruggle(struggling: StrugglingCard): string {
  const percent = Math.round(struggling.failureRate * 100);

  switch (struggling.reason) {
    case 'leech':
      return `Forgotten ${struggling.lapses} times. Worth rewording or setting aside.`;
    case 'lapsing':
      return `Forgotten ${struggling.lapses} times — heading for trouble.`;
    default:
      return `Missed ${percent}% of ${struggling.reviews} attempts.`;
  }
}
