import { describe, expect, it } from 'vitest';
import { LANGUAGE_CODES } from '../types/language';
import { findGrammarPoint, getGrammarPoints } from './index';
import {
  BLANK,
  buildGrammarExercises,
  checkTypedForm,
  formCandidates,
  type GrammarBlankExercise,
} from './exercises';

const point = (id: string) => {
  const found = findGrammarPoint(id);
  if (!found) throw new Error(`no such point: ${id}`);
  return found;
};

describe('building practice from a grammar point', () => {
  it('blanks the form out of the sentence, and keeps the rest', () => {
    const exercises = buildGrammarExercises(point('zh-shi'), { count: 20 });
    const blanks = exercises.filter((item): item is GrammarBlankExercise => item.kind === 'blank');

    expect(blanks.length).toBeGreaterThan(0);
    for (const blank of blanks) {
      expect(blank.sentence).toContain(BLANK);
      expect(blank.sentence).not.toContain(blank.answer);
      expect(blank.answer).toBe('是');
    }
  });

  it('offers the answer among its options', () => {
    const pool = getGrammarPoints('zh');
    const exercises = buildGrammarExercises(point('zh-shi'), { pool, count: 20 });

    for (const item of exercises) {
      if (item.kind !== 'blank') continue;
      expect(item.options).toContain(item.answer);
      expect(new Set(item.options).size).toBe(item.options.length);
    }
  });

  it('draws distractors from the same language, never from another', () => {
    const pool = getGrammarPoints('zh');
    const chinese = new Set(pool.flatMap(formCandidates));
    const exercises = buildGrammarExercises(point('zh-shi'), { pool, count: 20 });

    for (const item of exercises) {
      if (item.kind !== 'blank') continue;
      for (const option of item.options) expect(chinese.has(option), option).toBe(true);
    }
  });

  it('never offers a distractor the sentence already contains', () => {
    // 这不是我的书 contains both 不 and 的, so offering either as the missing
    // word would make the exercise answerable by looking at it.
    const pool = getGrammarPoints('zh');
    const exercises = buildGrammarExercises(point('zh-shi'), { pool, count: 20 });

    for (const item of exercises) {
      if (item.kind !== 'blank') continue;
      for (const option of item.options) {
        if (option === item.answer) continue;
        expect(item.sentence.includes(option), `${item.sentence} / ${option}`).toBe(false);
      }
    }
  });

  it('pairs sentences with meanings for matching', () => {
    const exercises = buildGrammarExercises(point('zh-shi'), { count: 20 });
    const match = exercises.find((item) => item.kind === 'match');

    expect(match).toBeDefined();
    if (match?.kind !== 'match') throw new Error('expected a matching exercise');
    expect(match.pairs.length).toBeGreaterThanOrEqual(2);
    for (const pair of match.pairs) {
      expect(pair.target.length).toBeGreaterThan(0);
      expect(pair.gloss.length).toBeGreaterThan(0);
    }
  });

  it('leads with matching, as the way in', () => {
    const exercises = buildGrammarExercises(point('zh-shi'), { count: 5 });
    expect(exercises[0]?.kind).toBe('match');
  });

  it('repeats for one seed and differs across seeds', () => {
    const pool = getGrammarPoints('zh');
    const a = buildGrammarExercises(point('zh-shi'), { pool, seed: 7, count: 5 });
    const b = buildGrammarExercises(point('zh-shi'), { pool, seed: 7, count: 5 });
    const c = buildGrammarExercises(point('zh-shi'), { pool, seed: 99, count: 5 });

    expect(a.map((item) => item.id)).toEqual(b.map((item) => item.id));
    expect(a.map((item) => item.id)).not.toEqual(c.map((item) => item.id));
  });

  it('produces something for every point the app ships', () => {
    for (const code of LANGUAGE_CODES) {
      const pool = getGrammarPoints(code);
      for (const item of pool) {
        const exercises = buildGrammarExercises(item, { pool, count: 5 });
        expect(exercises.length, item.id).toBeGreaterThan(0);
        // Even a point whose "form" is a word order rather than a word, which
        // cannot be blanked out of a sentence, still has to practise somehow.
        expect(exercises.some((e) => e.kind === 'recall' || e.kind === 'match'), item.id).toBe(true);
      }
    }
  });

  it('skips blanks when the form is a shape rather than a word', () => {
    // "noun + adjective" describes an order; there is nothing to remove.
    const exercises = buildGrammarExercises(point('vi-adjective-order'), { count: 20 });
    expect(exercises.some((item) => item.kind === 'blank')).toBe(false);
    expect(exercises.length).toBeGreaterThan(0);
  });

  it('honours the count asked for', () => {
    const pool = getGrammarPoints('zh');
    expect(buildGrammarExercises(point('zh-shi'), { pool, count: 3 })).toHaveLength(3);
    expect(buildGrammarExercises(point('zh-shi'), { pool, count: 1 })).toHaveLength(1);
  });
});

describe('checking a typed form', () => {
  it('accepts the answer, and forgives what is not being practised', () => {
    expect(checkTypedForm('是', '是')).toBe(true);
    expect(checkTypedForm(' 是 ', '是')).toBe(true);
    expect(checkTypedForm('は', 'は')).toBe(true);
    expect(checkTypedForm('Khong', 'khong')).toBe(true);
  });

  it('rejects a different form', () => {
    expect(checkTypedForm('很', '是')).toBe(false);
    expect(checkTypedForm('', '是')).toBe(false);
    expect(checkTypedForm('が', 'は')).toBe(false);
  });
});
