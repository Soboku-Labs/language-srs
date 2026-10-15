import { describe, expect, it } from 'vitest';
import { generateCards } from '../cards/factory';
import { MANDARIN_SEED } from '../data/seed/mandarin';
import { JAPANESE_SEED } from '../data/seed/japanese';
import { VIETNAMESE_SEED } from '../data/seed/vietnamese';
import type { Card, LexicalEntry } from '../types/card';
import type { CardKind } from '../types/exam';
import {
  buildChoiceOptions,
  buildToneOptions,
  checkTypedAnswer,
  editDistance,
  isAutoGraded,
  isTypingFeasible,
  normaliseAnswer,
  optionLabel,
  resolveAnswerMode,
  seededRandom,
  stripDiacritics,
  suggestRating,
} from './index';

const NOW = '2026-03-01T09:00:00.000Z';

function cardFor(entries: LexicalEntry[], scope: string[], kind: CardKind, entryId?: string): Card {
  const cards = generateCards(entries, scope, { now: NOW });
  const card = cards.find((c) => c.kind === kind && (!entryId || c.entryId === entryId));
  if (!card) throw new Error(`no ${kind} card${entryId ? ` for ${entryId}` : ''}`);
  return card;
}

const zhScope = ['hsk3-1', 'hsk3-2'];
const jaScope = ['jlpt-n5'];
const viScope = ['vsl-1'];

function entryOf(entries: LexicalEntry[], id: string): LexicalEntry {
  const entry = entries.find((candidate) => candidate.id === id);
  if (!entry) throw new Error(`no entry ${id}`);
  return entry;
}

describe('seeded shuffling', () => {
  it('is stable for the same seed and different for another', () => {
    const a = Array.from({ length: 5 }, seededRandom('card-1'));
    const b = Array.from({ length: 5 }, seededRandom('card-1'));
    const c = Array.from({ length: 5 }, seededRandom('card-2'));
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
  });

  it('stays inside [0, 1)', () => {
    const random = seededRandom('spread');
    for (let index = 0; index < 500; index += 1) {
      const value = random();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });
});

describe('multiple choice', () => {
  const card = cardFor(MANDARIN_SEED, zhScope, 'recognition', 'zh-chi');
  const entry = entryOf(MANDARIN_SEED, 'zh-chi');

  it('offers four options with exactly one correct', () => {
    const options = buildChoiceOptions({ card, entry, pool: MANDARIN_SEED });
    expect(options).toHaveLength(4);
    expect(options.filter((option) => option.correct)).toHaveLength(1);
  });

  it('includes the right answer', () => {
    const options = buildChoiceOptions({ card, entry, pool: MANDARIN_SEED });
    const correct = options.find((option) => option.correct)!;
    expect(correct.label).toBe(optionLabel('recognition', entry));
  });

  it('never repeats a label, so no two options can both be right', () => {
    for (const kind of ['recognition', 'production'] as const) {
      const subject = cardFor(MANDARIN_SEED, zhScope, kind, 'zh-chi');
      const options = buildChoiceOptions({ card: subject, entry, pool: MANDARIN_SEED });
      const labels = options.map((option) => option.label);
      expect(new Set(labels).size, kind).toBe(labels.length);
    }
  });

  it('is stable for a card so options do not reshuffle under the finger', () => {
    const first = buildChoiceOptions({ card, entry, pool: MANDARIN_SEED });
    const second = buildChoiceOptions({ card, entry, pool: MANDARIN_SEED });
    expect(first.map((o) => o.id)).toEqual(second.map((o) => o.id));
  });

  it('varies between sittings, so the position of the answer is not learnable', () => {
    const orders = new Set(
      [0, 1, 2, 3, 4].map((reps) =>
        buildChoiceOptions({ card, entry, pool: MANDARIN_SEED, seed: String(reps) })
          .findIndex((option) => option.correct)
          .toString(),
      ),
    );
    expect(orders.size).toBeGreaterThan(1);
  });

  it('prefers distractors that share a level or part of speech', () => {
    // 吃 is a level-1 verb; the pool has other level-1 verbs (喝, 买, 学习).
    const options = buildChoiceOptions({ card, entry, pool: MANDARIN_SEED });
    const distractors = options
      .filter((option) => !option.correct)
      .map((option) => MANDARIN_SEED.find((candidate) => candidate.id === option.id)!);

    const related = distractors.filter(
      (candidate) =>
        candidate.partOfSpeech === entry.partOfSpeech ||
        candidate.levelIds.some((id) => entry.levelIds.includes(id)),
    );
    expect(related.length).toBeGreaterThanOrEqual(2);
  });

  it('shows a reading under target-word options but not under meanings', () => {
    const production = cardFor(MANDARIN_SEED, zhScope, 'production', 'zh-chi');
    const produced = buildChoiceOptions({ card: production, entry, pool: MANDARIN_SEED });
    expect(produced.every((option) => option.sublabel)).toBe(true);

    const recognised = buildChoiceOptions({ card, entry, pool: MANDARIN_SEED });
    expect(recognised.every((option) => option.sublabel === undefined)).toBe(true);
  });

  it('returns a short list rather than padding when the pool is tiny', () => {
    const options = buildChoiceOptions({ card, entry, pool: [entry, MANDARIN_SEED[1]!] });
    expect(options.length).toBeLessThan(4);
    expect(options.filter((option) => option.correct)).toHaveLength(1);
  });
});

describe('tone questions', () => {
  const card = cardFor(MANDARIN_SEED, zhScope, 'tone', 'zh-nihao');
  const entry = entryOf(MANDARIN_SEED, 'zh-nihao');

  it('offers whole tone patterns, one of them right', () => {
    const options = buildToneOptions({ card, entry, pool: MANDARIN_SEED });
    expect(options.length).toBeGreaterThan(1);
    expect(options.filter((option) => option.correct)).toHaveLength(1);
    expect(options.find((option) => option.correct)!.id).toBe('3-3');
  });

  it('makes every distractor differ in exactly one syllable', () => {
    const options = buildToneOptions({ card, entry, pool: MANDARIN_SEED });
    const answer = entry.tones!;

    for (const option of options.filter((candidate) => !candidate.correct)) {
      const pattern = option.id.split('-').map(Number);
      const differences = pattern.filter((tone, index) => tone !== answer[index]).length;
      expect(differences, option.id).toBe(1);
    }
  });

  it('never repeats a pattern', () => {
    const options = buildToneOptions({ card, entry, pool: MANDARIN_SEED });
    expect(new Set(options.map((option) => option.id)).size).toBe(options.length);
  });

  it('names Vietnamese tones properly', () => {
    const viCard = cardFor(VIETNAMESE_SEED, viScope, 'tone', 'vi-xinchao');
    const viEntry = entryOf(VIETNAMESE_SEED, 'vi-xinchao');
    const options = buildToneOptions({ card: viCard, entry: viEntry, pool: VIETNAMESE_SEED });
    expect(options.find((option) => option.correct)!.label).toBe('ngang · huyền');
  });

  it('returns nothing for an entry with no tones', () => {
    const jaEntry = entryOf(JAPANESE_SEED, 'ja-hon');
    const jaCard = cardFor(JAPANESE_SEED, jaScope, 'recognition', 'ja-hon');
    expect(buildToneOptions({ card: jaCard, entry: jaEntry, pool: JAPANESE_SEED })).toEqual([]);
  });
});

describe('choosing an answer mode', () => {
  it('uses multiple choice when the pool can supply distractors', () => {
    const card = cardFor(MANDARIN_SEED, zhScope, 'recognition', 'zh-chi');
    const entry = entryOf(MANDARIN_SEED, 'zh-chi');
    expect(resolveAnswerMode(card, entry, MANDARIN_SEED)).toBe('choice');
  });

  it('falls back to self-grading rather than a two-option question', () => {
    const card = cardFor(MANDARIN_SEED, zhScope, 'recognition', 'zh-chi');
    const entry = entryOf(MANDARIN_SEED, 'zh-chi');
    expect(resolveAnswerMode(card, entry, [entry, MANDARIN_SEED[1]!])).toBe('self');
  });

  it('always self-grades handwriting, which happens on paper', () => {
    // Built by hand rather than generated: no seed entry sits at a level whose
    // paper has a writing section — HSK adds one at level 3, and the JLPT has
    // none at all — so the seed decks cannot produce a writing card.
    const entry = entryOf(MANDARIN_SEED, 'zh-chi');
    const card: Card = { ...cardFor(MANDARIN_SEED, zhScope, 'recognition', 'zh-chi'), kind: 'writing' };
    expect(resolveAnswerMode(card, entry, MANDARIN_SEED, 'typed')).toBe('self');
  });

  it('uses tone mode only when the entry has tones', () => {
    const toned = cardFor(MANDARIN_SEED, zhScope, 'tone', 'zh-nihao');
    expect(resolveAnswerMode(toned, entryOf(MANDARIN_SEED, 'zh-nihao'), MANDARIN_SEED)).toBe('tone');
  });

  it('honours an explicit preference for typing when the answer is the meaning', () => {
    const card = cardFor(MANDARIN_SEED, zhScope, 'recognition', 'zh-chi');
    const entry = entryOf(MANDARIN_SEED, 'zh-chi');
    expect(resolveAnswerMode(card, entry, MANDARIN_SEED, 'typed')).toBe('typed');
  });

  it('refuses typed production of a script no plain keyboard produces', () => {
    // Asking someone to type 吃 without an IME is not a hard question, it is an
    // impossible one — and the learner has no way to tell which it was.
    const card = cardFor(MANDARIN_SEED, zhScope, 'production', 'zh-chi');
    const entry = entryOf(MANDARIN_SEED, 'zh-chi');
    expect(resolveAnswerMode(card, entry, MANDARIN_SEED, 'typed')).toBe('choice');
  });

  it('allows typed production in Vietnamese, which a Latin keyboard can reach', () => {
    const card = cardFor(VIETNAMESE_SEED, viScope, 'production', 'vi-camon');
    const entry = entryOf(VIETNAMESE_SEED, 'vi-camon');
    expect(resolveAnswerMode(card, entry, VIETNAMESE_SEED, 'typed')).toBe('typed');
  });
});

describe('typing feasibility', () => {
  it('accepts meaning questions in every language', () => {
    for (const [seed, scope] of [
      [MANDARIN_SEED, zhScope],
      [JAPANESE_SEED, jaScope],
      [VIETNAMESE_SEED, viScope],
    ] as const) {
      const card = cardFor(seed, [...scope], 'recognition');
      const entry = entryOf(seed, card.entryId);
      expect(isTypingFeasible(card, entry)).toBe(true);
    }
  });

  it('rejects handwriting and tone patterns, which are not typed at all', () => {
    const entry = entryOf(MANDARIN_SEED, 'zh-nihao');
    const base = cardFor(MANDARIN_SEED, zhScope, 'tone', 'zh-nihao');
    expect(isTypingFeasible(base, entry)).toBe(false);
    expect(isTypingFeasible({ ...base, kind: 'writing' }, entry)).toBe(false);
  });
});

describe('typed answers', () => {
  const meaningCard = cardFor(MANDARIN_SEED, zhScope, 'recognition', 'zh-chi');
  const chi = entryOf(MANDARIN_SEED, 'zh-chi');

  it('accepts an exact meaning', () => {
    expect(checkTypedAnswer('to eat', meaningCard, chi).quality).toBe('exact');
  });

  it('is case- and punctuation-insensitive', () => {
    expect(checkTypedAnswer('  To Eat! ', meaningCard, chi).correct).toBe(true);
  });

  it('accepts one gloss out of several', () => {
    const nihao = entryOf(MANDARIN_SEED, 'zh-nihao');
    const card = cardFor(MANDARIN_SEED, zhScope, 'recognition', 'zh-nihao');
    expect(checkTypedAnswer('hi', card, nihao).correct).toBe(true);
    expect(checkTypedAnswer('hello', card, nihao).correct).toBe(true);
  });

  it('rejects an empty answer', () => {
    expect(checkTypedAnswer('   ', meaningCard, chi).quality).toBe('wrong');
  });

  it('rejects a different word', () => {
    expect(checkTypedAnswer('to drink', meaningCard, chi).quality).toBe('wrong');
  });

  it('calls out Vietnamese tones as close rather than wrong', () => {
    const entry = entryOf(VIETNAMESE_SEED, 'vi-dienthoai');
    const card = cardFor(VIETNAMESE_SEED, viScope, 'production', 'vi-dienthoai');
    const check = checkTypedAnswer('dien thoai', card, entry);

    expect(check.quality).toBe('close');
    // Still a failure for scheduling — the tones are part of the word.
    expect(check.correct).toBe(false);
    expect(check.note).toMatch(/tones/i);
  });

  it('calls out the reading given instead of the written form', () => {
    const entry = entryOf(JAPANESE_SEED, 'ja-benkyou');
    const card = cardFor(JAPANESE_SEED, jaScope, 'production', 'ja-benkyou');
    const check = checkTypedAnswer('べんきょう', card, entry);

    expect(check.quality).toBe('close');
    expect(check.note).toMatch(/reading/i);
    expect(check.expected).toBe('勉強');
  });

  it('forgives a single typo on a long answer but not a short one', () => {
    const entry = entryOf(MANDARIN_SEED, 'zh-yiyuan');
    const card = cardFor(MANDARIN_SEED, zhScope, 'recognition', 'zh-yiyuan');
    expect(checkTypedAnswer('hospitl', card, entry).quality).toBe('close');
    // "cat" against "eat" is one edit and pure luck, so it stays wrong.
    expect(checkTypedAnswer('to cat', meaningCard, chi).quality).not.toBe('exact');
  });

  it('accepts a written variant where the entry lists one', () => {
    const entry: LexicalEntry = {
      ...chi,
      variants: [{ script: 'hanzi-traditional', form: '喫' }],
    };
    const card = cardFor(MANDARIN_SEED, zhScope, 'production', 'zh-chi');
    expect(checkTypedAnswer('喫', card, entry).correct).toBe(true);
  });
});

describe('answer helpers', () => {
  it('normalises whitespace and case', () => {
    expect(normaliseAnswer('  Hello,   World! ')).toBe('hello world');
  });

  it('strips Vietnamese diacritics including the crossed d', () => {
    expect(stripDiacritics('điện thoại')).toBe('dien thoai');
  });

  it('caps edit distance rather than computing large values', () => {
    expect(editDistance('abc', 'abc')).toBe(0);
    expect(editDistance('abc', 'abd')).toBe(1);
    expect(editDistance('abc', 'xyzuvw', 3)).toBeGreaterThan(3);
  });
});

describe('rating suggestions', () => {
  const base = { mode: 'choice' as const, durationMs: 4000 };

  it('is Again for a wrong answer regardless of speed', () => {
    expect(suggestRating({ ...base, correct: false, durationMs: 500 })).toBe(1);
  });

  it('suggests Easy when fast and Hard when laboured', () => {
    expect(suggestRating({ ...base, correct: true, durationMs: 1500 })).toBe(4);
    expect(suggestRating({ ...base, correct: true, durationMs: 15000 })).toBe(2);
    expect(suggestRating({ ...base, correct: true, durationMs: 5000 })).toBe(3);
  });

  it('allows longer for typing, which is slow for reasons unrelated to recall', () => {
    expect(suggestRating({ mode: 'typed', correct: true, durationMs: 5000 })).toBe(4);
    // The same duration would have been merely Good on a choice question.
    expect(suggestRating({ mode: 'choice', correct: true, durationMs: 5000 })).toBe(3);
  });

  it('auto-grades a wrong answer only where the app actually knows', () => {
    expect(isAutoGraded({ mode: 'choice', correct: false, durationMs: 1 })).toBe(true);
    expect(isAutoGraded({ mode: 'choice', correct: true, durationMs: 1 })).toBe(false);
    expect(isAutoGraded({ mode: 'self', correct: false, durationMs: 1 })).toBe(false);
  });
});
