import type { GrammarPoint } from './index';

/**
 * Practice built from a grammar point, in more than one shape.
 *
 * Reading a point and ticking "understood" is a flashcard with more text on
 * it: the learner judges their own understanding at the moment it is freshest,
 * which is exactly when that judgement is worth least. Understanding is shown
 * by using the thing, and it is worth showing in several ways, because
 * recognising 是 among four options and producing it in a blank sentence are
 * different abilities that come apart.
 *
 * So a point generates exercises rather than a quiz. Four shapes, from the
 * easiest recognition to the hardest production:
 *
 * - **match** — pair sentences with meanings. Recognition, no production, and
 *   a gentle way in for somebody who has just read the explanation.
 * - **blank** — the sentence with the form removed and four candidates. The
 *   distractors are real forms from the same language, so a wrong answer is a
 *   plausible confusion rather than an obvious throwaway.
 * - **type** — the same gap with nothing to choose from. Production.
 * - **recall** — the pattern alone, with the explanation withheld. Checks the
 *   point is understood rather than the sentence memorised.
 *
 * Everything here is deterministic given a seed, so a test can assert on a
 * generated set and a learner can be given a different one each sitting.
 */

export type GrammarExerciseKind = 'match' | 'blank' | 'type' | 'recall';

interface Base {
  id: string;
  pointId: string;
  kind: GrammarExerciseKind;
}

/** Pair each sentence with what it means. */
export interface GrammarMatchExercise extends Base {
  kind: 'match';
  pairs: { id: string; target: string; gloss: string }[];
}

/** The sentence with the form taken out, and four candidates. */
export interface GrammarBlankExercise extends Base {
  kind: 'blank';
  sentence: string;
  answer: string;
  options: string[];
  gloss: string;
  reading?: string;
}

/** The same gap, with nothing to choose from. */
export interface GrammarTypeExercise extends Base {
  kind: 'type';
  sentence: string;
  answer: string;
  gloss: string;
}

/** The pattern, with the explanation withheld. */
export interface GrammarRecallExercise extends Base {
  kind: 'recall';
  form: string;
  pattern: string;
  answer: string;
}

export type GrammarExercise =
  | GrammarMatchExercise
  | GrammarBlankExercise
  | GrammarTypeExercise
  | GrammarRecallExercise;

/** The marker a blanked sentence carries, so the UI can split on it. */
export const BLANK = '＿＿';

/**
 * A small deterministic generator.
 *
 * Practice should differ between sittings and not between runs of a test, so
 * the shuffling is seeded rather than drawn from Math.random.
 */
function randomiser(seed: number): () => number {
  let state = seed >>> 0 || 1;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(items: T[], next: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(next() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/**
 * The forms a point is actually written with.
 *
 * A form is sometimes a pair — 不 / 没, 은 / 는 — and sometimes a description
 * of a shape rather than a word, as with "noun + adjective". Only the literal
 * ones can be removed from a sentence, so the descriptions are filtered out
 * here instead of producing a blank nobody can fill.
 */
export function formCandidates(point: GrammarPoint): string[] {
  return point.form
    .split('/')
    .map((part) => part.trim())
    .filter((part) => part.length > 0 && !part.includes(' ') && !part.includes('+'));
}

/** The candidate that appears in a sentence, if any does. */
function candidateIn(sentence: string, candidates: string[]): string | undefined {
  return candidates.find((candidate) => sentence.includes(candidate));
}

export interface BuildOptions {
  /** Other points in the same language, drawn on for plausible distractors. */
  pool?: GrammarPoint[];
  /** How many exercises to return. Fewer are returned if the point cannot fill it. */
  count?: number;
  seed?: number;
}

export function buildGrammarExercises(
  point: GrammarPoint,
  { pool = [], count = 5, seed = 1 }: BuildOptions = {},
): GrammarExercise[] {
  const next = randomiser(seed);
  const candidates = formCandidates(point);
  const built: GrammarExercise[] = [];

  // Matching first: it is the gentlest, and it wants at least two sentences to
  // be a pairing rather than a statement.
  if (point.examples.length >= 2) {
    const chosen = shuffle(point.examples, next).slice(0, Math.min(4, point.examples.length));
    built.push({
      id: `${point.id}:match`,
      pointId: point.id,
      kind: 'match',
      pairs: chosen.map((example, index) => ({
        id: `${point.id}:pair:${index}`,
        target: example.target,
        gloss: example.gloss,
      })),
    });
  }

  // Distractors are other points' forms in the same language: a learner who
  // confuses 에 with 에서 is making the mistake this is meant to catch, where
  // one from another language would only be noise.
  const distractorPool = [
    ...new Set(
      pool
        .filter((other) => other.id !== point.id && other.languageCode === point.languageCode)
        .flatMap(formCandidates),
    ),
  ];

  for (const example of point.examples) {
    const candidate = candidateIn(example.target, candidates);
    if (!candidate) continue;

    const sentence = example.target.replace(candidate, BLANK);
    const wrong = shuffle(
      distractorPool.filter((form) => form !== candidate && !example.target.includes(form)),
      next,
    ).slice(0, 3);

    built.push({
      id: `${point.id}:blank:${built.length}`,
      pointId: point.id,
      kind: 'blank',
      sentence,
      answer: candidate,
      // Only offer a choice when there is a real one. Two options is a coin
      // toss dressed up as a question.
      options: shuffle([candidate, ...wrong], next),
      gloss: example.gloss,
      ...(example.reading ? { reading: example.reading } : {}),
    });

    built.push({
      id: `${point.id}:type:${built.length}`,
      pointId: point.id,
      kind: 'type',
      sentence,
      answer: candidate,
      gloss: example.gloss,
    });
  }

  built.push({
    id: `${point.id}:recall`,
    pointId: point.id,
    kind: 'recall',
    form: point.form,
    pattern: point.pattern,
    answer: point.summary,
  });

  // Keep the matching exercise first as the way in, then mix the rest so two
  // sittings do not run in the same order.
  const [first, ...rest] = built;
  if (!first) return [];
  const ordered = first.kind === 'match' ? [first, ...shuffle(rest, next)] : shuffle(built, next);
  return ordered.slice(0, Math.max(1, count));
}

/**
 * Whether a typed answer counts.
 *
 * Generous about the things that are not the point — spaces, case, and the
 * full-width punctuation a CJK keyboard produces — and strict about the form
 * itself, since the form is what is being practised.
 */
export function checkTypedForm(typed: string, answer: string): boolean {
  const clean = (value: string) =>
    value
      .trim()
      .toLocaleLowerCase()
      .replace(/[\s。．.,，、!！?？]/g, '');
  return clean(typed) === clean(answer);
}
