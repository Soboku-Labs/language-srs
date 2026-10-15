import { describe, expect, it } from 'vitest';
import { LANGUAGE_CODES } from '../types/language';
import { getExamLevel } from '../exams';
import { findGrammarPoint, getGrammarPoints, getGrammarPointsForLevel } from './index';

/**
 * The content is the product here, so most of this checks the content rather
 * than the three functions that return it. A grammar point with no examples,
 * or one filed against a level that does not exist, is a bug a learner meets
 * directly — and it is exactly the kind that type checking cannot see.
 */
describe('the grammar syllabus', () => {
  it('ships points for every language the app teaches', () => {
    for (const code of LANGUAGE_CODES) {
      expect(getGrammarPoints(code).length, `no grammar for ${code}`).toBeGreaterThan(0);
    }
  });

  it('files every point against an exam level that exists', () => {
    for (const code of LANGUAGE_CODES) {
      for (const point of getGrammarPoints(code)) {
        // Throws on an unknown id, which is the assertion.
        const level = getExamLevel(point.levelId);
        expect(level.id).toBe(point.levelId);
      }
    }
  });

  it('gives every point a form, a pattern and at least two examples', () => {
    for (const code of LANGUAGE_CODES) {
      for (const point of getGrammarPoints(code)) {
        expect(point.form.length, point.id).toBeGreaterThan(0);
        expect(point.pattern.length, point.id).toBeGreaterThan(0);
        expect(point.summary.length, point.id).toBeGreaterThan(0);
        // One example shows the shape; two show it is a pattern and not a phrase.
        expect(point.examples.length, point.id).toBeGreaterThanOrEqual(2);
        for (const example of point.examples) {
          expect(example.target.length, point.id).toBeGreaterThan(0);
          expect(example.gloss.length, point.id).toBeGreaterThan(0);
        }
      }
    }
  });

  it('keeps ids unique across languages', () => {
    const ids = LANGUAGE_CODES.flatMap((code) => getGrammarPoints(code).map((point) => point.id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('only returns a language its own points', () => {
    for (const code of LANGUAGE_CODES) {
      for (const point of getGrammarPoints(code)) expect(point.languageCode).toBe(code);
    }
  });

  it('groups by level, and finds by id', () => {
    const first = getGrammarPoints('zh')[0]!;
    expect(getGrammarPointsForLevel(first.levelId)).toContainEqual(first);
    expect(findGrammarPoint(first.id)).toEqual(first);
    expect(findGrammarPoint('nothing-by-this-name')).toBeUndefined();
  });

  it('gives the scripted languages a reading on every example', () => {
    // Vietnamese is written in the Latin alphabet with its tones marked, so a
    // separate pronunciation line would repeat the sentence back.
    for (const code of ['zh', 'ja', 'ko'] as const) {
      for (const point of getGrammarPoints(code)) {
        for (const example of point.examples) {
          expect(example.reading, `${point.id}: ${example.target}`).toBeTruthy();
        }
      }
    }
  });
});
