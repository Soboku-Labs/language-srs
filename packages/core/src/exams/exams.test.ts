import { describe, expect, it } from 'vitest';
import { CARD_KINDS } from '../types/exam';
import { LANGUAGE_CODES, getLanguageProfile } from '../types/language';
import {
  EXAM_TRACKS,
  JLPT_TRACK,
  TOPIK_TRACK,
  getCumulativeLevels,
  getExamLevel,
  getExamTracksForLanguage,
  getExaminedSkills,
  getLevelIdsInScope,
  getNextLevel,
  getTrackForLevel,
  getVocabularyDelta,
  getWeightedCardKinds,
  normaliseCardWeights,
} from './index';

describe('exam track data', () => {
  it('covers every supported language', () => {
    for (const code of LANGUAGE_CODES) {
      expect(getExamTracksForLanguage(code).length).toBeGreaterThan(0);
    }
  });

  it('gives every language a resolvable default track', () => {
    for (const code of LANGUAGE_CODES) {
      const profile = getLanguageProfile(code);
      const tracks = getExamTracksForLanguage(code).map((track) => track.id);
      expect(tracks).toContain(profile.defaultExamTrackId);
    }
  });

  it('uses unique level ids across all tracks', () => {
    const ids = EXAM_TRACKS.flatMap((track) => track.levels.map((level) => level.id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('numbers levels consecutively from 1 within each track', () => {
    for (const track of EXAM_TRACKS) {
      expect(track.levels.map((level) => level.order)).toEqual(track.levels.map((_, index) => index + 1));
    }
  });

  it('states cumulative vocabulary targets that never decrease', () => {
    for (const track of EXAM_TRACKS) {
      const targets = track.levels.map((level) => level.vocabularyTarget);
      for (let index = 1; index < targets.length; index += 1) {
        expect(targets[index]!).toBeGreaterThan(targets[index - 1]!);
      }
    }
  });

  it('gives every level at least one section and one weighted card kind', () => {
    for (const track of EXAM_TRACKS) {
      for (const level of track.levels) {
        expect(level.sections.length).toBeGreaterThan(0);
        expect(getWeightedCardKinds(level).length).toBeGreaterThan(0);
      }
    }
  });

  it('only uses known card kinds in weights', () => {
    for (const track of EXAM_TRACKS) {
      for (const level of track.levels) {
        for (const kind of Object.keys(level.cardWeights)) {
          expect(CARD_KINDS).toContain(kind);
        }
      }
    }
  });

  it('keeps section scores consistent with the stated total', () => {
    for (const track of EXAM_TRACKS) {
      for (const level of track.levels) {
        if (level.totalScore === undefined) continue;
        const sum = level.sections.reduce((total, section) => total + (section.maxScore ?? 0), 0);
        expect(sum).toBe(level.totalScore);
      }
    }
  });

  it('sets a passing score no higher than the total', () => {
    for (const track of EXAM_TRACKS) {
      for (const level of track.levels) {
        if (level.passingScore === undefined || level.totalScore === undefined) continue;
        expect(level.passingScore).toBeLessThanOrEqual(level.totalScore);
      }
    }
  });
});

describe('exam-faithful card weights', () => {
  it('never asks a JLPT learner to handwrite, because the JLPT has no writing section', () => {
    for (const level of JLPT_TRACK.levels) {
      expect(level.cardWeights.writing ?? 0).toBe(0);
      expect(getExaminedSkills(level)).not.toContain('writing');
      expect(getExaminedSkills(level)).not.toContain('speaking');
    }
  });

  it('gives TOPIK II levels writing weight and TOPIK I levels none', () => {
    const topikI = TOPIK_TRACK.levels.filter((level) => level.order <= 2);
    const topikII = TOPIK_TRACK.levels.filter((level) => level.order >= 3);

    for (const level of topikI) {
      expect(level.cardWeights.writing ?? 0).toBe(0);
      expect(getExaminedSkills(level)).toEqual(['listening', 'reading']);
    }
    for (const level of topikII) {
      expect(level.cardWeights.writing ?? 0).toBeGreaterThan(0);
      expect(getExaminedSkills(level)).toContain('writing');
    }
  });

  it('weights script drills most heavily at the entry level of each script-heavy track', () => {
    for (const trackId of ['jlpt', 'topik']) {
      const track = EXAM_TRACKS.find((candidate) => candidate.id === trackId)!;
      const first = track.levels[0]!;
      const heaviest = getWeightedCardKinds(first)[0]!;
      expect(['script', 'recognition']).toContain(heaviest.kind);
    }
  });

  it('only gives tone weight to tonal languages', () => {
    for (const track of EXAM_TRACKS) {
      const tonal = getLanguageProfile(track.languageCode).tonal;
      for (const level of track.levels) {
        if (!tonal) expect(level.cardWeights.tone ?? 0).toBe(0);
      }
    }
  });

  it('normalises weights to sum to one', () => {
    const level = getExamLevel('hsk3-3');
    const normalised = normaliseCardWeights(level.cardWeights);
    const sum = Object.values(normalised).reduce((total, value) => total + value, 0);
    expect(sum).toBeCloseTo(1, 10);
  });

  it('returns nothing for empty weights rather than dividing by zero', () => {
    expect(normaliseCardWeights({})).toEqual({});
  });
});

describe('cumulative scope', () => {
  it('includes every level at or below the target', () => {
    expect(getLevelIdsInScope('jlpt-n3')).toEqual(['jlpt-n5', 'jlpt-n4', 'jlpt-n3']);
  });

  it('is a single level at the bottom of a track', () => {
    expect(getLevelIdsInScope('jlpt-n5')).toEqual(['jlpt-n5']);
  });

  it('orders scope easiest first', () => {
    const orders = getCumulativeLevels('hsk3-4').map((level) => level.order);
    expect(orders).toEqual([1, 2, 3, 4]);
  });

  it('resolves the track from a level alone', () => {
    expect(getTrackForLevel('topik-4').id).toBe('topik');
    expect(getTrackForLevel('vsl-2').languageCode).toBe('vi');
  });

  it('reports the next level, and nothing at the top', () => {
    expect(getNextLevel('jlpt-n5')?.id).toBe('jlpt-n4');
    expect(getNextLevel('jlpt-n1')).toBeUndefined();
  });

  it('computes new vocabulary at a level as the delta from the one below', () => {
    expect(getVocabularyDelta('jlpt-n5')).toBe(800);
    expect(getVocabularyDelta('jlpt-n4')).toBe(1500 - 800);
  });

  it('throws on an unknown level rather than returning empty scope', () => {
    expect(() => getLevelIdsInScope('nope-9')).toThrow(/Unknown exam level/);
  });
});
