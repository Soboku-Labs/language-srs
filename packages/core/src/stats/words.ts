import { cardRetrievability } from '../srs/scheduler';
import type { Card, LexicalEntry, Timestamp } from '../types/card';

/**
 * How well a learner knows a *word*, rather than a card.
 *
 * Everything else in this app reasons about cards, which is right for a
 * scheduler: 你好 as a recognition prompt and 你好 as a listening prompt are two
 * memories with two independent histories. It is the wrong grain for somebody
 * looking at their vocabulary. Nobody thinks "I know 你好 three-quarters of the
 * way"; they think they know the word, or they do not, or it keeps slipping.
 *
 * So a word's state is the *weakest* of its cards' states, not the average. If
 * you can recognise a word but cannot produce it, you do not know it yet — and
 * an average would report three-fifths of the way there, which is a number that
 * flatters and tells you nothing about what to do next.
 */

export type WordBand =
  /** No card for this word has ever been graded. */
  | 'unseen'
  /** In the learning steps, or lapsed back into them. */
  | 'learning'
  /** Graduated, but not yet held for long. */
  | 'young'
  /** Held long enough to count as known. */
  | 'mature'
  /** Graduated and repeatedly lost again. */
  | 'struggling';

export interface WordProgress {
  entryId: string;
  /**
   * Zero to one, for the gradient.
   *
   * Log-scaled against the maturity threshold, because memory is: the distance
   * between one day and one week is far more of an achievement than the distance
   * between eighty days and ninety, and a linear bar makes the first look like
   * nothing.
   */
  strength: number;
  band: WordBand;
  /** FSRS difficulty, normalised to zero-to-one. Undefined until first graded. */
  difficulty?: number;
  /** Days the weakest card is expected to survive. */
  stabilityDays: number;
  /** Times this word has been forgotten after graduating. */
  lapses: number;
  cards: number;
  /** When the next card for this word comes up. */
  dueAt?: Timestamp;
  /**
   * Recall probability *right now*, for the weakest card.
   *
   * Separate from `strength`, and worth both: stability is how durable the
   * memory is, this is how likely it is to be there today. A word can be strong
   * and still overdue, which is precisely the pair a learner wants to see.
   */
  retrievability: number;
}

/**
 * Days of stability at which a word counts as known.
 *
 * Twenty-one is the convention every SRS has settled on, and it is a convention
 * rather than a finding — but a shared one is worth more than a private one,
 * because a learner comparing this app to their old one should not have to
 * translate.
 */
export const MATURE_DAYS = 21;

/** The lapse count at which a word is worth rewriting rather than grinding. */
export const STRUGGLING_LAPSES = 4;

export function summariseWord(entryId: string, cards: Card[], now: Timestamp): WordProgress {
  const own = cards.filter((card) => card.entryId === entryId);

  if (own.length === 0) {
    return {
      entryId,
      strength: 0,
      band: 'unseen',
      stabilityDays: 0,
      lapses: 0,
      cards: 0,
      retrievability: 0,
    };
  }

  const seen = own.filter((card) => card.reps > 0);
  const lapses = own.reduce((total, card) => total + card.lapses, 0);
  const dueAt = own.map((card) => card.due).sort((a, b) => Date.parse(a) - Date.parse(b))[0];

  if (seen.length === 0) {
    return {
      entryId,
      strength: 0,
      band: 'unseen',
      stabilityDays: 0,
      lapses,
      cards: own.length,
      retrievability: 0,
      ...(dueAt ? { dueAt } : {}),
    };
  }

  // The weakest card decides, and an ungraded card is weaker than any graded
  // one: a word you can read but have never been asked to produce is not known.
  const weakest = own.reduce((worst, card) => (rank(card) < rank(worst) ? card : worst));
  const stabilityDays = weakest.stability;
  const strength = strengthOf(stabilityDays);

  const difficulty = seen.reduce((total, card) => total + card.difficulty, 0) / seen.length / 10;

  return {
    entryId,
    strength,
    band: bandOf(weakest, own.length > seen.length, lapses, stabilityDays),
    difficulty: clamp(difficulty),
    stabilityDays,
    lapses,
    cards: own.length,
    retrievability: Math.min(...seen.map((card) => cardRetrievability(card, now))),
    ...(dueAt ? { dueAt } : {}),
  };
}

/** Every word that has a card, in the order the entries were given. */
export function summariseWords(
  entries: LexicalEntry[],
  cards: Card[],
  now: Timestamp,
): WordProgress[] {
  const byEntry = new Map<string, Card[]>();
  for (const card of cards) {
    const bucket = byEntry.get(card.entryId);
    if (bucket) bucket.push(card);
    else byEntry.set(card.entryId, [card]);
  }

  return entries.map((entry) => summariseWord(entry.id, byEntry.get(entry.id) ?? [], now));
}

export type BandCounts = Record<WordBand, number>;

export function countBands(progress: WordProgress[]): BandCounts {
  const counts: BandCounts = { unseen: 0, learning: 0, young: 0, mature: 0, struggling: 0 };
  for (const word of progress) counts[word.band] += 1;
  return counts;
}

/**
 * How far through a level the learner is.
 *
 * Counts words that are *held*, not words that have been seen once: a level is
 * not half done because half of it appeared on screen yesterday.
 */
export function levelProgress(progress: WordProgress[]): number {
  if (progress.length === 0) return 0;
  const held = progress.filter((word) => word.band === 'mature' || word.band === 'young').length;
  return held / progress.length;
}

/** Mean recall probability across a set of words, right now. */
export function meanStrength(progress: WordProgress[]): number {
  if (progress.length === 0) return 0;
  return progress.reduce((total, word) => total + word.strength, 0) / progress.length;
}

/**
 * Order for display.
 *
 * Weakest first when sorting by strength, because the reason to look at a list
 * of your vocabulary is nearly always to find what is slipping. Unseen words go
 * last rather than first: they are not slipping, they simply have not started.
 */
export function byWeakestFirst(a: WordProgress, b: WordProgress): number {
  if (a.band === 'unseen' && b.band !== 'unseen') return 1;
  if (b.band === 'unseen' && a.band !== 'unseen') return -1;
  return a.strength - b.strength || b.lapses - a.lapses;
}

function rank(card: Card): number {
  // Never graded is weakest of all; after that, stability decides.
  if (card.reps === 0) return -1;
  return card.stability;
}

function bandOf(weakest: Card, hasUngraded: boolean, lapses: number, stabilityDays: number): WordBand {
  if (lapses >= STRUGGLING_LAPSES) return 'struggling';
  if (hasUngraded || weakest.reps === 0) return 'learning';
  if (weakest.state === 'learning' || weakest.state === 'relearning') return 'learning';
  return stabilityDays >= MATURE_DAYS ? 'mature' : 'young';
}

/** Log-scaled against the maturity threshold — see `WordProgress.strength`. */
function strengthOf(stabilityDays: number): number {
  if (stabilityDays <= 0) return 0;
  return clamp(Math.log1p(stabilityDays) / Math.log1p(MATURE_DAYS));
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/**
 * The words most worth a look, weakest first.
 *
 * Only words that have actually been studied and are actually slipping: an
 * unseen word is not a problem, and a word at ninety percent recall is not
 * either. `threshold` is recall probability, not stability, because "I am about
 * to lose this" is a question about today.
 */
export function wordsAtRisk(
  progress: WordProgress[],
  threshold = 0.85,
  limit = 12,
): WordProgress[] {
  return progress
    .filter((word) => word.band !== 'unseen' && word.retrievability < threshold)
    .sort((a, b) => a.retrievability - b.retrievability)
    .slice(0, limit);
}
