import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  EXAM_TRACKS,
  LANGUAGE_CODES,
  expandEntries,
  getLanguageProfile,
  getToneSystem,
  type LanguageCode,
} from '@language-srs/core';
import { VocabularyService } from './vocabulary.ts';

/**
 * The datasets, tested where they now live.
 *
 * These used to be core's tests, back when the word lists were compiled into the
 * app. They belong to the server now — it is the thing that reads the files —
 * and they are the same contract either way: a scraper that silently drops the
 * tone field, or maps a level to an id no exam track declares, produces a
 * dataset that looks fine in a diff and a deck that cannot be studied.
 */
const service = await VocabularyService.load(new URL('../../../../data/vocab/', import.meta.url).pathname);

const ALL_LEVEL_IDS = new Set(EXAM_TRACKS.flatMap((track) => track.levels.map((level) => level.id)));

function entriesFor(levelId: string) {
  const { languageCode, entries } = service.level(levelId);
  return expandEntries(entries, languageCode, levelId);
}

describe('the shipped vocabulary', () => {
  it('covers every level of every exam track', () => {
    for (const track of EXAM_TRACKS) {
      for (const level of track.levels) {
        expect(service.manifest.languages[track.languageCode].levels[level.id], level.id).toBeGreaterThan(0);
      }
    }
  });

  it('only uses level ids the exam tracks declare', () => {
    for (const code of LANGUAGE_CODES) {
      for (const levelId of Object.keys(service.manifest.languages[code].levels)) {
        expect(ALL_LEVEL_IDS.has(levelId), levelId).toBe(true);
      }
    }
  });

  it('serves a usable number of words per language', () => {
    for (const code of LANGUAGE_CODES) {
      expect(service.manifest.languages[code].total, code).toBeGreaterThan(1_000);
    }
  });

  it('gives every entry the fields a card needs', () => {
    for (const code of LANGUAGE_CODES) {
      for (const levelId of Object.keys(service.manifest.languages[code].levels)) {
        for (const entry of entriesFor(levelId)) {
          expect(entry.id, `${code} id`).toBeTruthy();
          expect(entry.target.length, entry.id).toBeGreaterThan(0);
          expect(entry.reading.length, entry.id).toBeGreaterThan(0);
          expect(entry.meanings.length, entry.id).toBeGreaterThan(0);
        }
      }
    }
  });

  it('keeps ids unique within a level', () => {
    for (const code of LANGUAGE_CODES) {
      for (const levelId of Object.keys(service.manifest.languages[code].levels)) {
        const ids = entriesFor(levelId).map((entry) => entry.id);
        expect(new Set(ids).size, levelId).toBe(ids.length);
      }
    }
  });

  /**
   * The tone drill exists for these two languages and nothing else generates the
   * data, so an entry without tones is a card that cannot be answered.
   */
  it('gives every word in a tonal language its tones, one per syllable', () => {
    for (const code of ['zh', 'vi'] as const) {
      const toneCount = getToneSystem(code).length;

      for (const levelId of Object.keys(service.manifest.languages[code].levels)) {
        for (const entry of entriesFor(levelId)) {
          expect(entry.tones, entry.id).toBeDefined();
          for (const tone of entry.tones!) {
            expect(tone, `${entry.id} tone ${tone}`).toBeGreaterThanOrEqual(1);
            expect(tone, `${entry.id} tone ${tone}`).toBeLessThanOrEqual(toneCount);
          }
        }
      }
    }
  });

  it('leaves the non-tonal languages without tones', () => {
    for (const code of ['ja', 'ko'] as const) {
      for (const levelId of Object.keys(service.manifest.languages[code].levels)) {
        for (const entry of entriesFor(levelId)) expect(entry.tones, entry.id).toBeUndefined();
      }
    }
  });

  it('orders each level by frequency, which is the order to learn them in', () => {
    for (const code of LANGUAGE_CODES) {
      for (const levelId of Object.keys(service.manifest.languages[code].levels)) {
        const ranks = entriesFor(levelId)
          .map((entry) => entry.frequencyRank)
          .filter((rank): rank is number => rank !== undefined);
        expect(ranks, levelId).toEqual([...ranks].sort((a, b) => a - b));
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
      for (const levelId of Object.keys(service.manifest.languages[code].levels)) {
        for (const entry of entriesFor(levelId)) {
          for (const meaning of entry.meanings) {
            expect(/[㐀-鿿]/.test(meaning), `${entry.id}: ${meaning}`).toBe(false);
            expect(/[a-z]/i.test(meaning), `${entry.id}: ${meaning}`).toBe(true);
          }
        }
      }
    }
  });

  it('matches the language profile on whether tones exist at all', () => {
    for (const code of LANGUAGE_CODES) {
      const profile = getLanguageProfile(code as LanguageCode);
      const levelId = Object.keys(service.manifest.languages[code].levels)[0]!;
      const hasTones = entriesFor(levelId).some((entry) => entry.tones?.length);
      expect(hasTones, code).toBe(profile.tonal);
    }
  });
});

describe('serving it', () => {
  it('versions itself from the content, so a rebuild invalidates every cache', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'srs-vocab-'));
    await writeFile(join(directory, 'zh.json'), JSON.stringify({ 'hsk3-1': [] }), 'utf8');

    const first = await VocabularyService.load(directory);
    await writeFile(join(directory, 'zh.json'), JSON.stringify({ 'hsk3-1': [{ i: 'x' }] }), 'utf8');
    const second = await VocabularyService.load(directory);

    expect(first.version).not.toBe(second.version);
  });

  /**
   * Accounts and vocabulary are separate jobs. A server missing its word lists
   * should still sign people in rather than refusing to start.
   */
  it('starts with no datasets at all', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'srs-vocab-'));
    const empty = await VocabularyService.load(directory);

    expect(empty.manifest.languages.zh.total).toBe(0);
    expect(() => empty.level('hsk3-1')).toThrow(/No vocabulary/);
  });

  it('refuses an unreasonable number of levels in one request', () => {
    expect(() => service.levels(Array.from({ length: 20 }, () => 'hsk3-1'))).toThrow(/twelve/);
  });

  it('names a source and licence for every language', () => {
    for (const code of LANGUAGE_CODES) {
      const source = service.manifest.sources[code];
      expect(source.url, code).toMatch(/^https:\/\//);
      expect(source.licence, code).toBeTruthy();
    }
    // HSK publishes its lists; the other three bodies do not, and the app says so.
    expect(service.manifest.sources.zh.official).toBe(true);
    for (const code of ['ja', 'ko', 'vi'] as const) {
      expect(service.manifest.sources[code].official, code).toBe(false);
    }
  });
});
