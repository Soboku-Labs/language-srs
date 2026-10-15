import type { Card, LexicalEntry } from '../types/card';
import type { CardKind } from '../types/exam';
import { getLanguageProfile } from '../types/language';
import { MEANING_KINDS, type AnswerMode, type AnswerOption } from './types';

/**
 * Multiple-choice question building.
 *
 * The distractors are the whole exercise. Three random words next to the right
 * answer is not a multiple-choice question, it is a reveal with extra steps — the
 * learner picks by elimination without ever retrieving anything. Real exam
 * distractors are near misses: the same part of speech, the same level, a similar
 * shape. So candidates are scored on how confusable they are and the best ones
 * win.
 */

/** How many options a question offers, matching the exam papers. */
export const CHOICE_COUNT = 4;

/**
 * A small deterministic PRNG.
 *
 * Options have to be stable while a card is on screen — re-rendering must not
 * reshuffle the answers under the learner's finger — but must vary between
 * sittings, or the position of the right answer becomes the thing being learned.
 * Seeding on the card id plus the attempt count gives both.
 */
export function seededRandom(seed: string): () => number {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  let state = hash >>> 0;
  return () => {
    // xorshift32
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 0x100000000;
  };
}

function shuffle<T>(items: T[], random: () => number): T[] {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [result[index], result[swap]] = [result[swap]!, result[index]!];
  }
  return result;
}

/** What an option reads as, given what the question asked. */
export function optionLabel(kind: CardKind, entry: LexicalEntry): string {
  if (MEANING_KINDS.includes(kind)) return entry.meanings.join(', ');
  return entry.target;
}

function optionSublabel(kind: CardKind, entry: LexicalEntry): string | undefined {
  // Showing the reading under a target would hand over the answer on a listening
  // question, so it appears only where the answer is the meaning.
  return MEANING_KINDS.includes(kind) ? undefined : entry.reading;
}

/**
 * Score how confusable a candidate is with the answer.
 *
 * Higher is a better distractor. The weights encode what actually makes exam
 * options hard: same level first, because a word from three levels above is
 * recognisably out of place; then part of speech, because a verb among nouns is
 * eliminated without being read.
 */
function confusability(candidate: LexicalEntry, answer: LexicalEntry, kind: CardKind): number {
  let score = 0;

  if (candidate.levelIds.some((id) => answer.levelIds.includes(id))) score += 4;
  if (candidate.partOfSpeech && candidate.partOfSpeech === answer.partOfSpeech) score += 3;
  if (candidate.tags.some((tag) => answer.tags.includes(tag))) score += 2;

  const label = optionLabel(kind, candidate);
  const answerLabel = optionLabel(kind, answer);
  if (Math.abs(label.length - answerLabel.length) <= 2) score += 1;

  // Same first character is a classic near-miss in character-based scripts.
  if (label.length > 0 && answerLabel.length > 0 && label[0] === answerLabel[0]) score += 2;

  return score;
}

export interface BuildChoiceOptions {
  card: Card;
  entry: LexicalEntry;
  /** Candidate pool, normally every entry for the language. */
  pool: LexicalEntry[];
  count?: number;
  /** Extra seed input so options vary between sittings of the same card. */
  seed?: string;
}

/**
 * Build the options for a multiple-choice question.
 *
 * Returns fewer than `count` options when the pool cannot supply enough distinct
 * distractors — a fresh install with six words cannot produce four plausible
 * options, and padding with duplicates would make the answer obvious. Callers
 * check the length and fall back to self-grading; see `resolveAnswerMode`.
 */
export function buildChoiceOptions(input: BuildChoiceOptions): AnswerOption[] {
  const { card, entry, pool } = input;
  const count = input.count ?? CHOICE_COUNT;
  const random = seededRandom(`${card.id}:${input.seed ?? card.reps}`);

  const answerLabel = optionLabel(card.kind, entry);

  const candidates = pool
    .filter((candidate) => candidate.id !== entry.id)
    .filter((candidate) => candidate.languageCode === entry.languageCode)
    // A distractor that reads identically to the answer is not a wrong option,
    // it is a second right one. Synonyms and homographs both land here.
    .filter((candidate) => optionLabel(card.kind, candidate) !== answerLabel);

  // Deduplicate by label so two entries glossed the same way cannot both appear.
  const byLabel = new Map<string, LexicalEntry>();
  for (const candidate of candidates) {
    const label = optionLabel(card.kind, candidate);
    if (!byLabel.has(label)) byLabel.set(label, candidate);
  }

  const ranked = [...byLabel.values()]
    .map((candidate) => ({ candidate, score: confusability(candidate, entry, card.kind), tie: random() }))
    // Ties broken by the seeded RNG rather than by pool order, so the same few
    // distractors do not follow a word around forever.
    .sort((a, b) => b.score - a.score || a.tie - b.tie)
    .slice(0, count - 1)
    .map(({ candidate }) => candidate);

  const options: AnswerOption[] = [
    { id: entry.id, label: answerLabel, correct: true, ...withSublabel(card.kind, entry) },
    ...ranked.map((candidate) => ({
      id: candidate.id,
      label: optionLabel(card.kind, candidate),
      correct: false,
      ...withSublabel(card.kind, candidate),
    })),
  ];

  return shuffle(options, random);
}

function withSublabel(kind: CardKind, entry: LexicalEntry): { sublabel?: string } {
  const sublabel = optionSublabel(kind, entry);
  return sublabel ? { sublabel } : {};
}

/** Tone names, in the conventional order for each language. */
const TONE_NAMES: Record<string, string[]> = {
  zh: ['1 high', '2 rising', '3 dipping', '4 falling', '5 neutral'],
  vi: ['ngang', 'huyền', 'sắc', 'hỏi', 'ngã', 'nặng'],
};

export function toneName(languageCode: string, tone: number): string {
  return TONE_NAMES[languageCode]?.[tone - 1] ?? String(tone);
}

/**
 * Options for a tone question.
 *
 * Each option is a whole tone pattern for the word, not one tone — the learner is
 * being asked to hear or recall the shape of the word, and picking tones one at a
 * time turns a single judgement into a series of coin flips.
 *
 * Distractors differ from the answer in exactly one syllable, which is the mistake
 * people actually make.
 */
export function buildToneOptions(input: BuildChoiceOptions): AnswerOption[] {
  const { card, entry } = input;
  const tones = entry.tones ?? [];
  if (tones.length === 0) return [];

  const profile = getLanguageProfile(entry.languageCode);
  const random = seededRandom(`${card.id}:tone:${input.seed ?? card.reps}`);
  const count = input.count ?? CHOICE_COUNT;

  const seen = new Set<string>([tones.join('-')]);
  const variants: number[][] = [];

  // Try every single-syllable substitution, in a seeded order, until there are
  // enough. Exhausting them on a one-syllable word with few tones is normal and
  // simply yields a shorter list.
  const positions = shuffle(
    tones.flatMap((_, position) =>
      Array.from({ length: profile.toneCount }, (_, index) => ({ position, tone: index + 1 })),
    ),
    random,
  );

  for (const { position, tone } of positions) {
    if (variants.length >= count - 1) break;
    if (tones[position] === tone) continue;

    const variant = [...tones];
    variant[position] = tone;
    const key = variant.join('-');
    if (seen.has(key)) continue;

    seen.add(key);
    variants.push(variant);
  }

  const toLabel = (pattern: number[]) =>
    pattern.map((tone) => toneName(entry.languageCode, tone)).join(' · ');

  const options: AnswerOption[] = [
    { id: tones.join('-'), label: toLabel(tones), correct: true },
    ...variants.map((variant) => ({
      id: variant.join('-'),
      label: toLabel(variant),
      correct: false,
    })),
  ];

  return shuffle(options, random);
}

/**
 * Whether this card can reasonably be typed on a phone keyboard.
 *
 * The constraint is the input method, not the difficulty. A question whose answer
 * is the English meaning can always be typed. A question whose answer is the
 * target word can only be typed where the script is one a default keyboard
 * produces — Vietnamese, and nothing else here. Asking for 图书馆 or 도서관 without
 * an IME installed is not a hard question, it is an impossible one, and the
 * learner would have no way to tell which.
 */
export function isTypingFeasible(card: Card, entry: LexicalEntry): boolean {
  if (card.kind === 'writing' || card.kind === 'tone') return false;
  if (MEANING_KINDS.includes(card.kind)) return true;
  return getLanguageProfile(entry.languageCode).scripts.includes('latin-vietnamese');
}

/**
 * Decide how a card should be answered.
 *
 * Falls back to self-grading whenever the richer mode cannot be built properly —
 * a pool too small for real distractors, or a tone card on a word with no tone
 * data. A degraded multiple-choice question with two options is worse than an
 * honest reveal.
 */
export function resolveAnswerMode(
  card: Card,
  entry: LexicalEntry,
  pool: LexicalEntry[],
  preferred?: AnswerMode,
): AnswerMode {
  if (preferred === 'self') return 'self';

  if (card.kind === 'tone') {
    return (entry.tones?.length ?? 0) > 0 ? 'tone' : 'self';
  }

  // Handwriting is done on paper. Typing it would test a different skill and
  // would be impossible on the character-based scripts without an IME.
  if (card.kind === 'writing') return 'self';

  // A preference for typing is honoured only where typing is possible; otherwise
  // it falls through to the same resolution as no preference at all.
  if (preferred === 'typed' && isTypingFeasible(card, entry)) return 'typed';

  const options = buildChoiceOptions({ card, entry, pool });
  return options.length >= 3 ? 'choice' : 'self';
}
