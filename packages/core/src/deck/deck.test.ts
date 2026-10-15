import { describe, expect, it } from 'vitest';
import { generateCards } from '../cards/factory';
import { MANDARIN_SEED } from '../data/seed/mandarin';
import { VIETNAMESE_SEED } from '../data/seed/vietnamese';
import { gradeCard } from '../srs/scheduler';
import type { Card } from '../types/card';
import { countByStatus, filterDeck, sortDeck, summariseDeck } from './index';

const NOW = '2026-03-01T09:00:00.000Z';
const zhScope = ['hsk3-1', 'hsk3-2'];
const viScope = ['vsl-1'];

function deckOf(entries = MANDARIN_SEED, scope = zhScope, cards?: Card[]) {
  return summariseDeck({
    entries,
    cards: cards ?? generateCards(entries, scope, { now: NOW }),
    now: NOW,
    targetLevelId: scope[0]!,
  });
}

describe('deck summary', () => {
  it('gives one row per word regardless of how many cards it has', () => {
    const deck = deckOf();
    expect(deck).toHaveLength(MANDARIN_SEED.length);
    expect(new Set(deck.map((row) => row.entry.id)).size).toBe(deck.length);
    expect(deck.some((row) => row.cards.length > 1)).toBe(true);
  });

  it('reports an ungraded word as new, with nothing due', () => {
    const row = deckOf().find((candidate) => candidate.cards.length > 0)!;
    expect(row.status).toBe('new');
    expect(row.dueNow).toBe(0);
    expect(row.weakest).toBeUndefined();
  });

  it('includes words with no cards at all rather than dropping them', () => {
    // Words outside the generated scope have no cards yet. A learner browsing
    // their deck should still see them — that is how they find out.
    const deck = summariseDeck({ entries: MANDARIN_SEED, cards: [], now: NOW });
    expect(deck).toHaveLength(MANDARIN_SEED.length);
    expect(deck.every((row) => row.status === 'new')).toBe(true);
  });

  it('follows a word into learning once one of its cards is graded', () => {
    const cards = generateCards(MANDARIN_SEED, zhScope, { now: NOW });
    const first = cards[0]!;
    const graded = gradeCard(first, 3, { now: NOW });
    const deck = deckOf(MANDARIN_SEED, zhScope, [graded.card, ...cards.slice(1)]);

    const row = deck.find((candidate) => candidate.entry.id === first.entryId)!;
    expect(row.status).toBe('learning');
    expect(row.weakest).toBeGreaterThan(0);
  });

  it('calls a word suspended only when every one of its cards is', () => {
    const cards = generateCards(MANDARIN_SEED, zhScope, { now: NOW });
    const target = cards[0]!.entryId;
    const mine = cards.filter((card) => card.entryId === target);
    expect(mine.length).toBeGreaterThan(1);

    const partly = cards.map((card) => (card.id === mine[0]!.id ? { ...card, suspended: true } : card));
    expect(deckOf(MANDARIN_SEED, zhScope, partly).find((r) => r.entry.id === target)!.status).toBe('new');

    const fully = cards.map((card) => (card.entryId === target ? { ...card, suspended: true } : card));
    expect(deckOf(MANDARIN_SEED, zhScope, fully).find((r) => r.entry.id === target)!.status).toBe(
      'suspended',
    );
  });

  it('takes the weakest card, not the average', () => {
    const cards = generateCards(MANDARIN_SEED, zhScope, { now: NOW });
    const target = cards[0]!.entryId;
    const mine = cards.filter((card) => card.entryId === target);

    // One card answered well and long ago, one lapsed just now: the word should
    // report the lapsed one, because that is the answer you will get wrong.
    const strong: Card = { ...mine[0]!, state: 'review', stability: 200, difficulty: 4, reps: 5, due: NOW };
    const weak: Card = { ...mine[1]!, state: 'review', stability: 0.4, difficulty: 9, reps: 5, due: NOW };
    const rest = cards.filter((card) => card.entryId !== target);

    const row = deckOf(MANDARIN_SEED, zhScope, [strong, weak, ...rest]).find(
      (candidate) => candidate.entry.id === target,
    )!;
    expect(row.weakest).toBeLessThan(0.99);
    expect(row.dueNow).toBe(2);
  });

  it('marks scope against the target level rather than dropping out-of-scope words', () => {
    const deck = summariseDeck({
      entries: MANDARIN_SEED,
      cards: generateCards(MANDARIN_SEED, zhScope, { now: NOW }),
      now: NOW,
      targetLevelId: 'hsk3-1',
    });
    expect(deck.some((row) => row.inScope)).toBe(true);
    expect(deck.some((row) => !row.inScope)).toBe(true);
  });
});

describe('deck search', () => {
  it('matches the written form, the reading and the meaning', () => {
    const deck = deckOf();
    const word = deck.find((row) => row.entry.id === 'zh-nihao')!.entry;

    expect(filterDeck(deck, { query: word.target })).toHaveLength(1);
    expect(filterDeck(deck, { query: 'hello' }).some((row) => row.entry.id === 'zh-nihao')).toBe(true);
  });

  it('finds a Vietnamese word typed without its diacritics', () => {
    // The keyboard that types the query is rarely the one that typed the word.
    const deck = deckOf(VIETNAMESE_SEED, viScope);
    const hit = filterDeck(deck, { query: 'camon' });
    expect(hit.map((row) => row.entry.id)).toContain('vi-camon');
  });

  it('ignores case and spacing', () => {
    const deck = deckOf(VIETNAMESE_SEED, viScope);
    expect(filterDeck(deck, { query: '  CẢM ƠN ' }).map((row) => row.entry.id)).toContain('vi-camon');
  });

  it('returns nothing for a query that matches nothing', () => {
    expect(filterDeck(deckOf(), { query: 'zzzzz' })).toHaveLength(0);
  });

  it('filters by status and by level, and combines with the query', () => {
    const deck = deckOf();
    expect(filterDeck(deck, { status: 'review' })).toHaveLength(0);
    expect(filterDeck(deck, { status: 'new' }).length).toBe(deck.length);

    const level = deck[0]!.entry.levelIds[0]!;
    const byLevel = filterDeck(deck, { levelId: level });
    expect(byLevel.length).toBeGreaterThan(0);
    expect(byLevel.every((row) => row.entry.levelIds.includes(level))).toBe(true);
  });

  it('drops out-of-scope words only when asked to', () => {
    const deck = deckOf();
    expect(filterDeck(deck, { inScopeOnly: true }).every((row) => row.inScope)).toBe(true);
    expect(filterDeck(deck).length).toBeGreaterThan(filterDeck(deck, { inScopeOnly: true }).length);
  });
});

describe('deck sorting', () => {
  it('sorts weakest first and puts unstudied words last', () => {
    const cards = generateCards(MANDARIN_SEED, zhScope, { now: NOW });
    const weak: Card = { ...cards[0]!, state: 'review', stability: 0.3, difficulty: 9, reps: 4, due: NOW };
    const deck = deckOf(MANDARIN_SEED, zhScope, [weak, ...cards.slice(1)]);

    const sorted = sortDeck(deck, 'weakest');
    expect(sorted[0]!.entry.id).toBe(weak.entryId);
    expect(sorted[sorted.length - 1]!.weakest).toBeUndefined();
  });

  it('sorts alphabetically by the written form', () => {
    const sorted = sortDeck(deckOf(), 'alphabetical').map((row) => row.entry.target);
    expect(sorted).toEqual([...sorted].sort((a, b) => a.localeCompare(b)));
  });

  it('does not mutate the deck it was given', () => {
    const deck = deckOf();
    const before = deck.map((row) => row.entry.id);
    sortDeck(deck, 'alphabetical');
    expect(deck.map((row) => row.entry.id)).toEqual(before);
  });
});

describe('status counts', () => {
  it('accounts for every row exactly once', () => {
    const deck = deckOf();
    const counts = countByStatus(deck);
    const total = counts.new + counts.learning + counts.review + counts.suspended;
    expect(total).toBe(deck.length);
  });
});
