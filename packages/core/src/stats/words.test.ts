import { describe, expect, it } from 'vitest';
import { createCard } from '../cards/factory';
import { makeEntry } from '../data/helpers';
import type { Card, LexicalEntry } from '../types/card';
import { addDays } from '../utils/date';
import {
  MATURE_DAYS,
  STRUGGLING_LAPSES,
  byWeakestFirst,
  countBands,
  levelProgress,
  meanStrength,
  summariseWord,
  summariseWords,
  wordsAtRisk,
  type WordProgress,
} from './words';

const NOW = '2026-03-01T09:00:00.000Z';

function entry(id: string): LexicalEntry {
  return makeEntry({
    id,
    lang: 'zh',
    target: id,
    reading: id,
    meanings: [id],
    levels: ['hsk3-1'],
  });
}

/** A card in whatever memory state the test needs, without running the scheduler. */
function card(entryId: string, kind: 'recognition' | 'production', state: Partial<Card>): Card {
  return {
    ...createCard(entry(entryId), kind, 'hsk3-1', NOW),
    ...state,
  };
}

const reviewed = (days: number, extra: Partial<Card> = {}): Partial<Card> => ({
  state: 'review',
  reps: 3,
  stability: days,
  difficulty: 5,
  lastReviewedAt: NOW,
  due: addDays(NOW, days),
  ...extra,
});

describe('a word is the weakest of its cards', () => {
  it('takes the weaker card’s stability, not the average', () => {
    const cards = [
      card('e1', 'recognition', reviewed(60)),
      card('e1', 'production', reviewed(2)),
    ];

    const word = summariseWord('e1', cards, NOW);

    expect(word.stabilityDays).toBe(2);
    expect(word.cards).toBe(2);
  });

  it('treats a never-graded card as weaker than any graded one', () => {
    const cards = [
      card('e1', 'recognition', reviewed(90)),
      card('e1', 'production', { state: 'new', reps: 0 }),
    ];

    const word = summariseWord('e1', cards, NOW);

    // Recognising a word you have never had to produce is not knowing it.
    expect(word.band).toBe('learning');
    expect(word.strength).toBe(0);
  });

  it('averages difficulty over graded cards only', () => {
    const cards = [
      card('e1', 'recognition', reviewed(10, { difficulty: 4 })),
      card('e1', 'production', reviewed(10, { difficulty: 8 })),
    ];

    expect(summariseWord('e1', cards, NOW).difficulty).toBeCloseTo(0.6, 5);
  });
});

describe('bands', () => {
  it('calls a word with no cards unseen', () => {
    const word = summariseWord('e1', [], NOW);
    expect(word).toMatchObject({ band: 'unseen', cards: 0, strength: 0, retrievability: 0 });
    expect(word.difficulty).toBeUndefined();
  });

  it('calls a word with only ungraded cards unseen, but knows they exist', () => {
    const word = summariseWord('e1', [card('e1', 'recognition', {})], NOW);
    expect(word.band).toBe('unseen');
    expect(word.cards).toBe(1);
    expect(word.dueAt).toBe(NOW);
  });

  it('matures exactly at the threshold', () => {
    const under = summariseWord('e1', [card('e1', 'recognition', reviewed(MATURE_DAYS - 0.1))], NOW);
    const at = summariseWord('e1', [card('e1', 'recognition', reviewed(MATURE_DAYS))], NOW);

    expect(under.band).toBe('young');
    expect(at.band).toBe('mature');
  });

  it('keeps a card in the learning steps out of the review bands', () => {
    const word = summariseWord(
      'e1',
      [card('e1', 'recognition', { state: 'learning', reps: 1, stability: 30, difficulty: 5 })],
      NOW,
    );
    expect(word.band).toBe('learning');
  });

  it('calls a repeatedly-lost word struggling however stable it looks now', () => {
    const word = summariseWord(
      'e1',
      [card('e1', 'recognition', reviewed(90, { lapses: STRUGGLING_LAPSES }))],
      NOW,
    );
    expect(word.band).toBe('struggling');
  });

  it('sums lapses across a word’s cards', () => {
    const cards = [
      card('e1', 'recognition', reviewed(30, { lapses: 2 })),
      card('e1', 'production', reviewed(30, { lapses: 2 })),
    ];
    // Neither card is struggling alone; the word is.
    expect(summariseWord('e1', cards, NOW).lapses).toBe(4);
    expect(summariseWord('e1', cards, NOW).band).toBe('struggling');
  });
});

describe('strength', () => {
  it('runs from nothing at zero days to one at maturity', () => {
    expect(summariseWord('e1', [card('e1', 'recognition', reviewed(0))], NOW).strength).toBe(0);
    expect(
      summariseWord('e1', [card('e1', 'recognition', reviewed(MATURE_DAYS))], NOW).strength,
    ).toBeCloseTo(1, 5);
  });

  it('is log-scaled, so early days count for more than late ones', () => {
    const at = (days: number) =>
      summariseWord('e1', [card('e1', 'recognition', reviewed(days))], NOW).strength;

    const firstWeek = at(7) - at(0);
    const secondWeek = at(14) - at(7);

    expect(firstWeek).toBeGreaterThan(secondWeek);
  });

  it('never exceeds one, however stable the card', () => {
    expect(summariseWord('e1', [card('e1', 'recognition', reviewed(4000))], NOW).strength).toBe(1);
  });
});

describe('retrievability', () => {
  it('is high the day of a review and lower once the interval has run', () => {
    const fresh = summariseWord('e1', [card('e1', 'recognition', reviewed(10))], NOW);
    const stale = summariseWord(
      'e1',
      [card('e1', 'recognition', reviewed(10))],
      addDays(NOW, 20),
    );

    expect(fresh.retrievability).toBeGreaterThan(0.9);
    expect(stale.retrievability).toBeLessThan(fresh.retrievability);
  });

  it('reports the weakest card’s recall, not the mean', () => {
    const cards = [
      card('e1', 'recognition', reviewed(200)),
      card('e1', 'production', reviewed(1)),
    ];
    const solo = summariseWord('e2', [card('e2', 'production', reviewed(1))], addDays(NOW, 5));

    expect(summariseWord('e1', cards, addDays(NOW, 5)).retrievability).toBeCloseTo(
      solo.retrievability,
      5,
    );
  });
});

describe('summariseWords', () => {
  const entries = [entry('e1'), entry('e2'), entry('e3')];
  const cards = [
    card('e1', 'recognition', reviewed(MATURE_DAYS + 5)),
    card('e2', 'recognition', reviewed(3)),
  ];

  it('returns one row per entry, in the order given, including untouched words', () => {
    const progress = summariseWords(entries, cards, NOW);

    expect(progress.map((word) => word.entryId)).toEqual(['e1', 'e2', 'e3']);
    expect(progress.map((word) => word.band)).toEqual(['mature', 'young', 'unseen']);
  });

  it('ignores cards belonging to entries outside the set', () => {
    const stray = [...cards, card('e9', 'recognition', reviewed(50))];
    expect(summariseWords(entries, stray, NOW)).toHaveLength(3);
  });

  it('counts bands', () => {
    expect(countBands(summariseWords(entries, cards, NOW))).toEqual({
      unseen: 1,
      learning: 0,
      young: 1,
      mature: 1,
      struggling: 0,
    });
  });
});

describe('levelProgress', () => {
  const progress = (bands: WordProgress['band'][]): WordProgress[] =>
    bands.map((band, index) => ({
      entryId: `e${index}`,
      band,
      strength: 0,
      stabilityDays: 0,
      lapses: 0,
      cards: 1,
      retrievability: 0,
    }));

  it('counts words held, not words met', () => {
    // Two seen once, two held: half done, not all done.
    expect(levelProgress(progress(['learning', 'learning', 'young', 'mature']))).toBe(0.5);
  });

  it('gives struggling words no credit', () => {
    expect(levelProgress(progress(['struggling', 'mature']))).toBe(0.5);
  });

  it('is zero for an empty level rather than NaN', () => {
    expect(levelProgress([])).toBe(0);
    expect(meanStrength([])).toBe(0);
  });
});

describe('byWeakestFirst', () => {
  it('puts weak words first and unseen words last', () => {
    const entries = [entry('strong'), entry('weak'), entry('unseen')];
    const cards = [
      card('strong', 'recognition', reviewed(60)),
      card('weak', 'recognition', reviewed(1)),
    ];

    const order = summariseWords(entries, cards, NOW).sort(byWeakestFirst);

    // Unseen words are not slipping; they have simply not started.
    expect(order.map((word) => word.entryId)).toEqual(['weak', 'strong', 'unseen']);
  });

  it('breaks ties on strength with the more-lapsed word first', () => {
    const cards = [
      card('a', 'recognition', reviewed(5)),
      card('b', 'recognition', reviewed(5, { lapses: 3 })),
    ];
    const order = summariseWords([entry('a'), entry('b')], cards, NOW).sort(byWeakestFirst);

    expect(order[0]?.entryId).toBe('b');
  });
});

describe('wordsAtRisk', () => {
  const entries = [entry('slipping'), entry('safe'), entry('untouched')];
  const cards = [
    card('slipping', 'recognition', reviewed(2)),
    card('safe', 'recognition', reviewed(400)),
  ];

  it('reports only studied words whose recall has actually fallen', () => {
    const risk = wordsAtRisk(summariseWords(entries, cards, addDays(NOW, 6)));
    expect(risk.map((word) => word.entryId)).toEqual(['slipping']);
  });

  it('reports nothing the day everything was reviewed', () => {
    expect(wordsAtRisk(summariseWords(entries, cards, NOW))).toEqual([]);
  });

  it('honours the limit', () => {
    const many = Array.from({ length: 30 }, (_, index) => entry(`e${index}`));
    const manyCards = many.map((item) => card(item.id, 'recognition', reviewed(1)));
    const risk = wordsAtRisk(summariseWords(many, manyCards, addDays(NOW, 10)), 0.85, 5);

    expect(risk).toHaveLength(5);
  });
});
