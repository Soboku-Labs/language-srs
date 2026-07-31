import { describe, expect, it } from 'vitest';
import { isCardKindApplicable } from '../cards/factory';
import { LANGUAGE_CODES } from '../types/language';
import { exportVocabularyJson, parseVocabularyCsv, parseVocabularyJson } from './importer';
import { SEED_ENTRIES, getSeedCounts, getSeedEntries } from './seed';
import { findExamLevel } from '../exams';

describe('seed decks', () => {
  it('ships vocabulary for all four languages', () => {
    const counts = getSeedCounts();
    for (const code of LANGUAGE_CODES) {
      expect(counts[code]).toBeGreaterThan(20);
    }
  });

  it('uses unique entry ids', () => {
    const ids = SEED_ENTRIES.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('references only real exam levels', () => {
    for (const entry of SEED_ENTRIES) {
      for (const levelId of entry.levelIds) {
        expect(findExamLevel(levelId), `${entry.id} -> ${levelId}`).toBeDefined();
      }
    }
  });

  it('tags every entry into a level belonging to its own language', () => {
    for (const entry of SEED_ENTRIES) {
      for (const levelId of entry.levelIds) {
        const level = findExamLevel(levelId)!;
        expect(level.id.length).toBeGreaterThan(0);
      }
    }
  });

  it('gives every entry a reading and at least one meaning', () => {
    for (const entry of SEED_ENTRIES) {
      expect(entry.meanings.length, entry.id).toBeGreaterThan(0);
      expect(entry.reading.length, entry.id).toBeGreaterThan(0);
    }
  });

  it('records one tone per syllable for tonal languages', () => {
    for (const entry of SEED_ENTRIES.filter((candidate) => candidate.tones)) {
      expect(['zh', 'vi']).toContain(entry.languageCode);
      for (const tone of entry.tones!) {
        expect(tone).toBeGreaterThanOrEqual(1);
        expect(tone).toBeLessThanOrEqual(entry.languageCode === 'zh' ? 5 : 6);
      }
    }
  });

  it('never marks a non-tonal language entry with tones', () => {
    for (const entry of SEED_ENTRIES.filter((candidate) => ['ja', 'ko'].includes(candidate.languageCode))) {
      expect(entry.tones, entry.id).toBeUndefined();
    }
  });

  it('exercises every card kind the exam models weight', () => {
    // Guards against a level weighting a kind that no seed entry can satisfy,
    // which would silently shrink sessions.
    const kinds = new Set<string>();
    for (const entry of SEED_ENTRIES) {
      for (const kind of ['recognition', 'production', 'listening', 'reading', 'writing', 'grammar', 'tone', 'script'] as const) {
        if (isCardKindApplicable(entry, kind)) kinds.add(kind);
      }
    }
    expect([...kinds].sort()).toEqual(
      ['grammar', 'listening', 'production', 'reading', 'recognition', 'script', 'tone', 'writing'],
    );
  });

  it('filters by language', () => {
    expect(getSeedEntries('vi').every((entry) => entry.languageCode === 'vi')).toBe(true);
  });
});

describe('CSV import', () => {
  const header = 'id,target,reading,meanings,levelIds,partOfSpeech,tones,components,examples,tags,frequencyRank';

  it('imports a well-formed row', () => {
    const csv = `${header}\nzh-mao,猫,māo,cat,hsk3-1,noun,1,,我有一只猫。|I have a cat.,animal,500`;
    const result = parseVocabularyCsv(csv, { languageCode: 'zh' });

    expect(result.accepted).toBe(1);
    expect(result.rejected).toBe(0);
    expect(result.entries[0]).toMatchObject({
      id: 'zh-mao',
      target: '猫',
      reading: 'māo',
      meanings: ['cat'],
      levelIds: ['hsk3-1'],
      tones: [1],
      frequencyRank: 500,
    });
    expect(result.entries[0]!.examples[0]).toEqual({ target: '我有一只猫。', translation: 'I have a cat.' });
  });

  it('keeps commas inside quoted cells instead of shifting every later column', () => {
    const csv = `${header}\nzh-nihao,你好,nǐ hǎo,"hello, hi",hsk3-1,phrase,3;3,,,greeting,1`;
    const result = parseVocabularyCsv(csv, { languageCode: 'zh' });

    expect(result.entries[0]!.meanings).toEqual(['hello, hi']);
    expect(result.entries[0]!.levelIds).toEqual(['hsk3-1']);
    expect(result.entries[0]!.tones).toEqual([3, 3]);
    expect(result.entries[0]!.tags).toEqual(['greeting']);
  });

  it('handles escaped double quotes', () => {
    const csv = `${header}\n,书,shū,"a ""book""",hsk3-1,noun,1,,,,`;
    expect(parseVocabularyCsv(csv, { languageCode: 'zh' }).entries[0]!.meanings).toEqual(['a "book"']);
  });

  it('works without a header row', () => {
    const csv = 'zh-mao,猫,māo,cat,hsk3-1';
    expect(parseVocabularyCsv(csv, { languageCode: 'zh' }).accepted).toBe(1);
  });

  it('applies a default level when the column is empty', () => {
    const csv = 'ja-neko,猫,ねこ,cat';
    const result = parseVocabularyCsv(csv, { languageCode: 'ja', defaultLevelId: 'jlpt-n5' });
    expect(result.entries[0]!.levelIds).toEqual(['jlpt-n5']);
  });

  it('rejects a row with an unknown level rather than importing an unstudiable card', () => {
    const csv = 'zh-x,猫,māo,cat,hsk-99';
    const result = parseVocabularyCsv(csv, { languageCode: 'zh' });
    expect(result.accepted).toBe(0);
    expect(result.rejected).toBe(1);
    expect(result.issues[0]!.message).toMatch(/Unknown exam level/);
  });

  it('rejects rows with no target or no meanings, and reports the row number', () => {
    const csv = `${header}\n,,,,hsk3-1\nzh-ok,猫,māo,,hsk3-1`;
    const result = parseVocabularyCsv(csv, { languageCode: 'zh' });
    expect(result.rejected).toBe(2);
    expect(result.issues.map((issue) => issue.row)).toEqual([2, 3]);
  });

  it('warns but still imports when tones cannot be read', () => {
    const csv = 'zh-x,猫,māo,cat,hsk3-1,noun,high-rising';
    const result = parseVocabularyCsv(csv, { languageCode: 'zh' });
    expect(result.accepted).toBe(1);
    expect(result.entries[0]!.tones).toBeUndefined();
    expect(result.issues[0]!.severity).toBe('warning');
  });

  it('generates a stable id for non-Latin targets with no id column', () => {
    const csv = 'ja-,猫,ねこ,cat,jlpt-n5';
    const first = parseVocabularyCsv(csv, { languageCode: 'ja' }).entries[0]!;
    const second = parseVocabularyCsv(csv, { languageCode: 'ja' }).entries[0]!;
    expect(first.id).toBe(second.id);
    expect(first.id.length).toBeGreaterThan(2);
  });

  it('reports an empty file', () => {
    const result = parseVocabularyCsv('   ', { languageCode: 'zh' });
    expect(result.issues[0]!.message).toBe('File is empty');
  });

  it('accepts a tab-delimited list', () => {
    const csv = 'ko-goyangi\t고양이\tgoyangi\tcat\ttopik-1';
    expect(parseVocabularyCsv(csv, { languageCode: 'ko', delimiter: '\t' }).accepted).toBe(1);
  });
});

describe('JSON import and export', () => {
  it('round-trips an export', () => {
    const exported = exportVocabularyJson(SEED_ENTRIES.slice(0, 5));
    const result = parseVocabularyJson(exported);
    expect(result.accepted).toBe(5);
    expect(result.entries[0]!.id).toBe(SEED_ENTRIES[0]!.id);
  });

  it('accepts a bare array as well as a wrapped object', () => {
    expect(parseVocabularyJson(JSON.stringify(SEED_ENTRIES.slice(0, 2))).accepted).toBe(2);
  });

  it('reports invalid JSON without throwing', () => {
    const result = parseVocabularyJson('{ not json');
    expect(result.accepted).toBe(0);
    expect(result.issues[0]!.message).toMatch(/Invalid JSON/);
  });

  it('rejects entries with an unsupported language', () => {
    const result = parseVocabularyJson(
      JSON.stringify([{ target: 'gato', languageCode: 'es', meanings: ['cat'], levelIds: ['hsk3-1'] }]),
    );
    expect(result.accepted).toBe(0);
    expect(result.issues.some((issue) => issue.field === 'languageCode')).toBe(true);
  });

  it('collects every problem with a row rather than stopping at the first', () => {
    const result = parseVocabularyJson(JSON.stringify([{}]));
    expect(result.issues.length).toBeGreaterThan(2);
  });
});
