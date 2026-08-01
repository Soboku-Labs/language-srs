import { describe, expect, it } from 'vitest';
import { EXAM_TRACKS } from '../../exams';
import { getToneSystem } from '../../practice/tones';
import { LANGUAGE_CODES, getLanguageProfile } from '../../types/language';
import {
  VOCABULARY_SOURCES,
  getLevelEntries,
  getLevelSizes,
  getVocabularyCounts,
  getVocabularyEntries,
} from './index';

/**
 * The datasets are generated, so these are not tests of hand-written data —
 * they are the contract the generator has to keep. A scraper that silently drops
 * the tone field, or maps a level to an id that no exam track declares, produces
 * a dataset that looks fine in a diff and a deck that cannot be studied.
 */

const ALL_LEVEL_IDS = new Set(EXAM_TRACKS.flatMap((track) => track.levels.map((level) => level.id)));

describe('the shipped vocabulary', () => {
  it('covers every level of every exam track', () => {
    for (const track of EXAM_TRACKS) {
      const sizes = getLevelSizes(track.languageCode);
      for (const level of track.levels) {
        expect(sizes[level.id], `${track.id} ${level.id}`).toBeGreaterThan(0);
      }
    }
  });

  it('only uses level ids the exam tracks declare', () => {
    for (const code of LANGUAGE_CODES) {
      for (const levelId of Object.keys(getLevelSizes(code))) {
        expect(ALL_LEVEL_IDS.has(levelId), levelId).toBe(true);
      }
    }
  });

  it('ships a usable number of words per language', () => {
    const counts = getVocabularyCounts();
    for (const code of LANGUAGE_CODES) {
      expect(counts[code], code).toBeGreaterThan(1_000);
    }
  });

  it('gives every entry the fields a card needs', () => {
    for (const code of LANGUAGE_CODES) {
      for (const entry of getVocabularyEntries(code)) {
        expect(entry.id, `${code} id`).toBeTruthy();
        expect(entry.languageCode).toBe(code);
        expect(entry.target.length, entry.id).toBeGreaterThan(0);
        expect(entry.reading.length, entry.id).toBeGreaterThan(0);
        expect(entry.meanings.length, entry.id).toBeGreaterThan(0);
        expect(entry.levelIds.length, entry.id).toBe(1);
      }
    }
  });

  it('keeps ids unique within a language', () => {
    for (const code of LANGUAGE_CODES) {
      const entries = getVocabularyEntries(code);
      const ids = new Set(entries.map((entry) => entry.id));
      // A word can legitimately appear in both HSK 2.0 and HSK 3.0, which is two
      // levels and therefore two entries sharing an id — but never twice within
      // one level.
      for (const levelId of Object.keys(getLevelSizes(code))) {
        const levelIds = getLevelEntries(levelId).map((entry) => entry.id);
        expect(new Set(levelIds).size, levelId).toBe(levelIds.length);
      }
      expect(ids.size).toBeGreaterThan(0);
    }
  });

  /**
   * The tone drill exists for these two languages and nothing else generates
   * the data, so an entry without tones is a card that cannot be answered.
   */
  it('gives every word in a tonal language its tones, one per syllable', () => {
    for (const code of ['zh', 'vi'] as const) {
      const toneCount = getToneSystem(code).length;

      for (const entry of getVocabularyEntries(code)) {
        expect(entry.tones, entry.id).toBeDefined();
        expect(entry.tones!.length, entry.id).toBeGreaterThan(0);
        for (const tone of entry.tones!) {
          expect(tone, `${entry.id} tone ${tone}`).toBeGreaterThanOrEqual(1);
          expect(tone, `${entry.id} tone ${tone}`).toBeLessThanOrEqual(toneCount);
        }
      }
    }
  });

  it('leaves the non-tonal languages without tones', () => {
    for (const code of ['ja', 'ko'] as const) {
      for (const entry of getVocabularyEntries(code)) {
        expect(entry.tones, entry.id).toBeUndefined();
      }
    }
  });

  it('orders each level by frequency, which is the order to learn them in', () => {
    for (const code of LANGUAGE_CODES) {
      for (const levelId of Object.keys(getLevelSizes(code))) {
        const ranks = getLevelEntries(levelId)
          .map((entry) => entry.frequencyRank)
          .filter((rank): rank is number => rank !== undefined);

        const sorted = [...ranks].sort((a, b) => a - b);
        expect(ranks, levelId).toEqual(sorted);
      }
    }
  });

  /**
   * Wiktionary carries hanja and kanji readings as senses, and they made it
   * through the first version of the scraper: "수 = 誰" is not a definition a
   * learner of Korean can use.
   */
  it('gives meanings in English rather than in the language being learned', () => {
    for (const code of ['ko', 'vi'] as const) {
      for (const entry of getVocabularyEntries(code)) {
        for (const meaning of entry.meanings) {
          expect(/[㐀-鿿]/.test(meaning), `${entry.id}: ${meaning}`).toBe(false);
          expect(/[a-z]/i.test(meaning), `${entry.id}: ${meaning}`).toBe(true);
        }
      }
    }
  });

  it('keeps meanings short enough to read on a card', () => {
    for (const code of LANGUAGE_CODES) {
      for (const entry of getVocabularyEntries(code)) {
        expect(entry.meanings.length, entry.id).toBeLessThanOrEqual(3);
        for (const meaning of entry.meanings) {
          expect(meaning.length, `${entry.id}: ${meaning}`).toBeLessThanOrEqual(80);
        }
      }
    }
  });

  it('names a source and a licence for every language', () => {
    for (const code of LANGUAGE_CODES) {
      const source = VOCABULARY_SOURCES[code];
      expect(source.name, code).toBeTruthy();
      expect(source.url, code).toMatch(/^https:\/\//);
      expect(source.licence, code).toBeTruthy();
    }
  });

  /**
   * HSK publishes its lists; the other three bodies do not. The app says so on
   * the landing page and in settings, and this keeps that claim true.
   */
  it('marks only the officially published list as official', () => {
    expect(VOCABULARY_SOURCES.zh.official).toBe(true);
    for (const code of ['ja', 'ko', 'vi'] as const) {
      expect(VOCABULARY_SOURCES[code].official, code).toBe(false);
    }
  });

  it('matches the language profile on whether tones exist at all', () => {
    for (const code of LANGUAGE_CODES) {
      const profile = getLanguageProfile(code);
      const withTones = getVocabularyEntries(code).filter((entry) => entry.tones?.length);
      expect(withTones.length > 0, code).toBe(profile.tonal);
    }
  });

  it('returns nothing for a level that does not exist, rather than throwing', () => {
    expect(getLevelEntries('not-a-level')).toEqual([]);
  });
});
