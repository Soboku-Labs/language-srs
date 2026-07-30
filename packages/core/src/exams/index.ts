import type { CardKind, CardKindWeights, ExamLevel, ExamTrack } from '../types/exam';
import type { LanguageCode } from '../types/language';
import { HSK2_TRACK, HSK3_TRACK } from './mandarin';
import { JLPT_TRACK } from './japanese';
import { TOPIK_TRACK } from './korean';
import { VSL_TRACK } from './vietnamese';

export { HSK2_TRACK, HSK3_TRACK } from './mandarin';
export { JLPT_TRACK } from './japanese';
export { TOPIK_TRACK } from './korean';
export { VSL_TRACK } from './vietnamese';

export const EXAM_TRACKS: ExamTrack[] = [HSK3_TRACK, HSK2_TRACK, JLPT_TRACK, TOPIK_TRACK, VSL_TRACK];

const TRACKS_BY_ID = new Map(EXAM_TRACKS.map((track) => [track.id, track]));

const LEVELS_BY_ID = new Map<string, { track: ExamTrack; level: ExamLevel }>(
  EXAM_TRACKS.flatMap((track) => track.levels.map((level) => [level.id, { track, level }] as const)),
);

export function getExamTrack(trackId: string): ExamTrack {
  const track = TRACKS_BY_ID.get(trackId);
  if (!track) throw new Error(`Unknown exam track: ${trackId}`);
  return track;
}

export function findExamTrack(trackId: string): ExamTrack | undefined {
  return TRACKS_BY_ID.get(trackId);
}

export function getExamTracksForLanguage(code: LanguageCode): ExamTrack[] {
  return EXAM_TRACKS.filter((track) => track.languageCode === code);
}

export function getExamLevel(levelId: string): ExamLevel {
  const entry = LEVELS_BY_ID.get(levelId);
  if (!entry) throw new Error(`Unknown exam level: ${levelId}`);
  return entry.level;
}

export function findExamLevel(levelId: string): ExamLevel | undefined {
  return LEVELS_BY_ID.get(levelId)?.level;
}

/** The track a level belongs to, for resolving language and authority from a level alone. */
export function getTrackForLevel(levelId: string): ExamTrack {
  const entry = LEVELS_BY_ID.get(levelId);
  if (!entry) throw new Error(`Unknown exam level: ${levelId}`);
  return entry.track;
}

export function getLanguageForLevel(levelId: string): LanguageCode {
  return getTrackForLevel(levelId).languageCode;
}

/**
 * Levels at or below the target, easiest first.
 *
 * Exam vocabulary targets are cumulative, so studying for JLPT N2 means
 * reviewing N5-N2 material, not N2 material alone. Every place that builds a
 * study scope goes through here so that stays consistent.
 */
export function getCumulativeLevels(levelId: string): ExamLevel[] {
  const { track, level } = requireEntry(levelId);
  return track.levels.filter((candidate) => candidate.order <= level.order);
}

export function getLevelIdsInScope(levelId: string): string[] {
  return getCumulativeLevels(levelId).map((level) => level.id);
}

/** The next level up, or undefined at the top of the track. */
export function getNextLevel(levelId: string): ExamLevel | undefined {
  const { track, level } = requireEntry(levelId);
  return track.levels.find((candidate) => candidate.order === level.order + 1);
}

/**
 * New vocabulary introduced at a level, rather than the cumulative total.
 * Useful for "how much is left at this level" progress rather than
 * "how much is left in the language".
 */
export function getVocabularyDelta(levelId: string): number {
  const { track, level } = requireEntry(levelId);
  const previous = track.levels.find((candidate) => candidate.order === level.order - 1);
  return level.vocabularyTarget - (previous?.vocabularyTarget ?? 0);
}

/** Card kinds a level actually exercises, heaviest first. */
export function getWeightedCardKinds(level: ExamLevel): { kind: CardKind; weight: number }[] {
  return Object.entries(level.cardWeights)
    .filter((entry): entry is [CardKind, number] => typeof entry[1] === 'number' && entry[1] > 0)
    .map(([kind, weight]) => ({ kind, weight }))
    .sort((a, b) => b.weight - a.weight || a.kind.localeCompare(b.kind));
}

/** Weights normalised to sum to 1, for turning them into session proportions. */
export function normaliseCardWeights(weights: CardKindWeights): Record<string, number> {
  const entries = Object.entries(weights).filter(
    (entry): entry is [string, number] => typeof entry[1] === 'number' && entry[1] > 0,
  );
  const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
  if (total === 0) return {};
  return Object.fromEntries(entries.map(([kind, weight]) => [kind, weight / total]));
}

/** Skills the level's paper actually reports a score for. */
export function getExaminedSkills(level: ExamLevel): string[] {
  return [...new Set(level.sections.map((section) => section.skill))];
}

function requireEntry(levelId: string) {
  const entry = LEVELS_BY_ID.get(levelId);
  if (!entry) throw new Error(`Unknown exam level: ${levelId}`);
  return entry;
}
