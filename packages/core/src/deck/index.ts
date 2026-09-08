import { getLevelIdsInScope } from '../exams';
import { cardRetrievability } from '../srs/scheduler';
import type { Card, LexicalEntry, Timestamp } from '../types/card';
import { stripDiacritics } from '../answer/check';
import { isDue, toEpochMs } from '../utils/date';

/**
 * The deck: the learner's words, as words rather than as cards.
 *
 * The app has always known about cards, and a card is the wrong unit for a person
 * looking something up. Nobody wants to know that `vi-camon:listening` is due on
 * Thursday; they want to know whether they know "cảm ơn", and roughly how well.
 * So this collapses a word's cards back into one row.
 *
 * Pure, like everything in core — the same summary drives the browser on web, on
 * both phones, and anything a widget later wants to show.
 */

export type DeckStatus =
  /** No card for this word has ever been graded. */
  | 'new'
  /** In the learning ladder, or knocked back into it by a lapse. */
  | 'learning'
  /** On real intervals. */
  | 'review'
  /** Every card for it is suspended — deliberately out of rotation. */
  | 'suspended';

export interface DeckEntry {
  entry: LexicalEntry;
  cards: Card[];
  status: DeckStatus;
  /** Cards due right now, buried and suspended ones excluded. */
  dueNow: number;
  /**
   * Recall probability for the *weakest* of its cards, not the mean.
   *
   * A word whose meaning is solid and whose tones are gone is not 60% known, it
   * is a word you will get wrong — and the list should say so.
   */
  weakest?: number;
  /** Soonest upcoming due date across its active cards. */
  nextDueAt?: Timestamp;
  /** Whether the word is inside the current target level's cumulative scope. */
  inScope: boolean;
}

export interface SummariseDeckOptions {
  entries: LexicalEntry[];
  cards: Card[];
  now: Timestamp;
  /** Target level, for marking what is inside the current syllabus scope. */
  targetLevelId?: string;
}

/** Collapse cards into one row per word. */
export function summariseDeck(options: SummariseDeckOptions): DeckEntry[] {
  const { entries, cards, now } = options;
  const scope = options.targetLevelId ? new Set(getLevelIdsInScope(options.targetLevelId)) : undefined;

  const byEntry = new Map<string, Card[]>();
  for (const card of cards) {
    const existing = byEntry.get(card.entryId);
    if (existing) existing.push(card);
    else byEntry.set(card.entryId, [card]);
  }

  return entries.map((entry) => {
    const entryCards = byEntry.get(entry.id) ?? [];
    const active = entryCards.filter((card) => !card.suspended);

    let dueNow = 0;
    let weakest: number | undefined;
    let nextDueAtMs = Number.POSITIVE_INFINITY;

    for (const card of active) {
      const buried = card.buriedUntil !== undefined && !isDue(card.buriedUntil, now);
      if (card.state !== 'new') {
        const recall = cardRetrievability(card, now);
        weakest = weakest === undefined ? recall : Math.min(weakest, recall);
      }
      if (!buried && card.state !== 'new' && isDue(card.due, now)) dueNow += 1;
      if (card.state !== 'new') nextDueAtMs = Math.min(nextDueAtMs, toEpochMs(card.due));
    }

    return {
      entry,
      cards: entryCards,
      status: deckStatus(entryCards, active),
      dueNow,
      ...(weakest !== undefined ? { weakest } : {}),
      ...(Number.isFinite(nextDueAtMs) ? { nextDueAt: new Date(nextDueAtMs).toISOString() } : {}),
      inScope: scope ? entry.levelIds.some((id) => scope.has(id)) : true,
    };
  });
}

function deckStatus(all: Card[], active: Card[]): DeckStatus {
  // Suspension is a property of every card at once, not a majority vote: a word
  // with one card left in rotation is still being studied.
  if (all.length > 0 && active.length === 0) return 'suspended';
  if (active.some((card) => card.state === 'learning' || card.state === 'relearning')) return 'learning';
  if (active.some((card) => card.state === 'review')) return 'review';
  return 'new';
}

export interface DeckFilter {
  /** Free text, matched against the word, its reading and its meanings. */
  query?: string;
  status?: DeckStatus;
  /** Restrict to one curriculum level. */
  levelId?: string;
  /** Drop words outside the current target level's scope. */
  inScopeOnly?: boolean;
}

/**
 * Search and filter the deck.
 *
 * Matching folds diacritics, so someone typing "camon" on a plain keyboard finds
 * "cảm ơn". That is not a nicety for Vietnamese — it is the difference between
 * the search box working and not working, because the phone keyboard that types
 * the query is rarely the one that typed the word.
 */
export function filterDeck(deck: DeckEntry[], filter: DeckFilter = {}): DeckEntry[] {
  const needle = filter.query ? searchKey(filter.query) : '';

  return deck.filter((row) => {
    if (filter.status && row.status !== filter.status) return false;
    if (filter.levelId && !row.entry.levelIds.includes(filter.levelId)) return false;
    if (filter.inScopeOnly && !row.inScope) return false;
    if (!needle) return true;

    return searchHaystack(row.entry).includes(needle);
  });
}

function searchKey(input: string): string {
  return stripDiacritics(input.normalize('NFC').toLowerCase()).replace(/\s+/g, '');
}

function searchHaystack(entry: LexicalEntry): string {
  return searchKey([entry.target, entry.reading, ...entry.meanings].join(' '));
}

export type DeckSort = 'alphabetical' | 'weakest' | 'due' | 'level';

/** Order the deck. Rows with nothing to compare on sort to the end, not the top. */
export function sortDeck(deck: DeckEntry[], sort: DeckSort = 'level'): DeckEntry[] {
  const rows = [...deck];

  switch (sort) {
    case 'alphabetical':
      return rows.sort((a, b) => a.entry.target.localeCompare(b.entry.target));

    case 'weakest':
      return rows.sort((a, b) => (a.weakest ?? 2) - (b.weakest ?? 2));

    case 'due':
      return rows.sort(
        (a, b) =>
          (a.nextDueAt ? toEpochMs(a.nextDueAt) : Number.POSITIVE_INFINITY) -
          (b.nextDueAt ? toEpochMs(b.nextDueAt) : Number.POSITIVE_INFINITY),
      );

    default:
      return rows.sort((a, b) => {
        const levelA = a.entry.levelIds[0] ?? '';
        const levelB = b.entry.levelIds[0] ?? '';
        if (levelA !== levelB) return levelA.localeCompare(levelB);
        return (a.entry.frequencyRank ?? Number.MAX_SAFE_INTEGER) -
          (b.entry.frequencyRank ?? Number.MAX_SAFE_INTEGER);
      });
  }
}

/** Counts per status, for the filter chips. */
export function countByStatus(deck: DeckEntry[]): Record<DeckStatus, number> {
  const counts: Record<DeckStatus, number> = { new: 0, learning: 0, review: 0, suspended: 0 };
  for (const row of deck) counts[row.status] += 1;
  return counts;
}
