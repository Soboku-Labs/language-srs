import { describe, expect, it } from 'vitest';
import { makeEntry } from '../data/helpers';
import { getSeedEntries } from '../data/seed';
import { LANGUAGE_CODES, getLanguageProfile } from '../types/language';
import { checkTonePattern, checkWrittenAnswer } from './check';
import { describeTonePattern, getToneDescriptor, getToneSystem } from './tones';

const NIHAO = makeEntry({
  id: 'zh-nihao',
  lang: 'zh',
  target: '你好',
  reading: 'nǐ hǎo',
  meanings: ['hello'],
  levels: ['hsk3-1'],
  tones: [3, 3],
});

const HOC = makeEntry({
  id: 'vi-hoc',
  lang: 'vi',
  target: 'học',
  reading: 'học',
  meanings: ['to study'],
  levels: ['vsl-a1'],
  tones: [6],
});

describe('checkWrittenAnswer', () => {
  it('accepts the exact written form', () => {
    expect(checkWrittenAnswer(NIHAO, '你好').verdict).toBe('correct');
  });

  it('ignores case, surrounding space and punctuation', () => {
    expect(checkWrittenAnswer(HOC, '  Học. ').verdict).toBe('correct');
  });

  it('accepts a script variant, not only the canonical form', () => {
    const entry = { ...NIHAO, variants: [{ script: 'hanzi-traditional' as const, form: '妳好' }] };
    expect(checkWrittenAnswer(entry, '妳好').verdict).toBe('correct');
  });

  /**
   * The distinction the whole function exists for: a Vietnamese learner who types
   * the right word without its tone mark has made a tone error, which is a
   * different piece of feedback from having produced the wrong word.
   */
  it('calls a missing tone mark close rather than wrong', () => {
    const result = checkWrittenAnswer(HOC, 'hoc');
    expect(result.verdict).toBe('close');
    expect(result.note).toMatch(/diacritics/);
  });

  it('names the reading-for-target confusion specifically', () => {
    const result = checkWrittenAnswer(NIHAO, 'ni hao');
    expect(result.verdict).toBe('close');
    expect(result.note).toMatch(/reading/);
  });

  it('rejects a different word', () => {
    expect(checkWrittenAnswer(NIHAO, '再见').verdict).toBe('wrong');
  });

  it('treats an empty attempt as wrong rather than as a match', () => {
    expect(checkWrittenAnswer(NIHAO, '   ').verdict).toBe('wrong');
  });

  it('compares decomposed and precomposed input equal', () => {
    // The same word from a keyboard that emits combining marks rather than
    // precomposed characters: identical on screen, different code points.
    expect(checkWrittenAnswer(HOC, 'học'.normalize('NFD')).verdict).toBe('correct');
  });

  it('always reports the form it measured against', () => {
    expect(checkWrittenAnswer(NIHAO, 'anything').expected).toBe('你好');
  });
});

describe('checkTonePattern', () => {
  it('accepts the right tones in the right order', () => {
    expect(checkTonePattern(NIHAO, [3, 3]).correct).toBe(true);
  });

  it('rejects the right tones in the wrong order and says which syllable', () => {
    const xiexie = makeEntry({
      id: 'zh-xiexie',
      lang: 'zh',
      target: '谢谢',
      reading: 'xièxie',
      meanings: ['thanks'],
      levels: ['hsk3-1'],
      tones: [4, 5],
    });

    const result = checkTonePattern(xiexie, [5, 4]);
    expect(result.correct).toBe(false);
    expect(result.wrongIndexes).toEqual([0, 1]);
  });

  it('marks only the syllable that was wrong', () => {
    const result = checkTonePattern(NIHAO, [3, 4]);
    expect(result.wrongIndexes).toEqual([1]);
  });

  it('treats an incomplete attempt as wrong rather than partially right', () => {
    expect(checkTonePattern(NIHAO, [3]).correct).toBe(false);
  });

  it('rejects an attempt longer than the word', () => {
    expect(checkTonePattern(NIHAO, [3, 3, 1]).correct).toBe(false);
  });

  it('cannot pass an entry that carries no tones', () => {
    const kanji = makeEntry({
      id: 'ja-hon',
      lang: 'ja',
      target: '本',
      reading: 'ほん',
      meanings: ['book'],
      levels: ['jlpt-n5'],
    });
    expect(checkTonePattern(kanji, []).correct).toBe(false);
  });
});

describe('tone systems', () => {
  it('gives a descriptor per tone for tonal languages and none for the rest', () => {
    for (const code of LANGUAGE_CODES) {
      const profile = getLanguageProfile(code);
      expect(getToneSystem(code), code).toHaveLength(profile.tonal ? profile.toneCount : 0);
    }
  });

  it('numbers tones from one, matching what entries store', () => {
    for (const code of ['zh', 'vi'] as const) {
      expect(getToneSystem(code).map((tone) => tone.value)).toEqual(
        getToneSystem(code).map((_, index) => index + 1),
      );
    }
  });

  /**
   * Seed entries are the answer key for the tone drill, so a tone number that has
   * no descriptor would render as a bare digit on a button with nothing to tap.
   */
  it('describes every tone the seed decks actually use', () => {
    for (const code of ['zh', 'vi'] as const) {
      for (const entry of getSeedEntries(code)) {
        for (const tone of entry.tones ?? []) {
          expect(getToneDescriptor(code, tone), `${entry.id} tone ${tone}`).toBeDefined();
        }
      }
    }
  });

  it('spells a pattern out in the language’s own tone names', () => {
    expect(describeTonePattern('vi', [3, 2])).toBe('sắc · huyền');
  });

  it('falls back to the number for a tone it does not know', () => {
    expect(describeTonePattern('zh', [9])).toBe('9');
  });
});
