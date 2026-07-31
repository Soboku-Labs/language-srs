import type { LexicalEntry } from '../types/card';

/**
 * Checking a learner's attempt.
 *
 * Two of the card kinds can be answered rather than only revealed: a production
 * card can be typed, and a tone card can be tapped out. Both checks live here
 * rather than in the review screen for the usual reason — they are rules about
 * the language, they need testing against real entries, and the web build and the
 * two native builds must not disagree about whether an answer was right.
 *
 * What this deliberately does *not* do is grade. FSRS is driven by the learner's
 * own judgement of recall, and an automatic "wrong, therefore Again" would
 * mis-schedule every answer that was right but mistyped. The check informs the
 * grade; it does not make it.
 */

export type AnswerVerdict =
  /** Matches the expected written form. */
  | 'correct'
  /** Right word, wrong marks — diacritics, tone marks, or the reading typed instead. */
  | 'close'
  | 'wrong';

export interface WrittenCheck {
  verdict: AnswerVerdict;
  /** The form the answer was measured against. */
  expected: string;
  /** Why it is `close` rather than `correct`, when it is. */
  note?: string;
}

/**
 * Compare a typed attempt against an entry's written form.
 *
 * Accepts the canonical target and any script variant — a learner writing 書く in
 * traditional or a kanji spelling of a kana word has not made a mistake.
 *
 * The `close` verdict is the reason this is not a string equality check. Typing
 * `hoi` for `hỏi`, or `ma` for `mā`, is a tone error and worth naming as one; and
 * typing the reading where the characters were asked for is a specific,
 * extremely common confusion that deserves a specific answer rather than "wrong".
 */
export function checkWrittenAnswer(entry: LexicalEntry, input: string): WrittenCheck {
  const attempt = normalise(input);
  const expected = entry.target;

  if (attempt.length === 0) return { verdict: 'wrong', expected };

  const accepted = [entry.target, ...(entry.variants ?? []).map((variant) => variant.form)];
  if (accepted.some((form) => normalise(form) === attempt)) {
    return { verdict: 'correct', expected };
  }

  if (accepted.some((form) => stripMarks(normalise(form)) === stripMarks(attempt))) {
    return {
      verdict: 'close',
      expected,
      note: 'Right word, wrong marks — check the diacritics.',
    };
  }

  const reading = normalise(entry.reading);
  if (reading.length > 0 && (reading === attempt || stripMarks(reading) === stripMarks(attempt))) {
    return {
      verdict: 'close',
      expected,
      note: 'That is the reading. The card is asking for the written form.',
    };
  }

  return { verdict: 'wrong', expected };
}

export interface ToneCheck {
  correct: boolean;
  expected: number[];
  /** Syllable positions that were answered wrongly, so the UI can mark them. */
  wrongIndexes: number[];
}

/**
 * Compare a tapped-out tone pattern against an entry's tones.
 *
 * Positional, not set-based: 你好 is [3, 3] and 谢谢 is [4, 5], and getting the
 * right tones in the wrong order is exactly the mistake a tone drill exists to
 * catch. An entry with no tones — a non-tonal language, or an incomplete import —
 * cannot be checked, and says so by returning `correct: false` with no expected
 * pattern rather than passing everything.
 */
export function checkTonePattern(entry: LexicalEntry, attempt: number[]): ToneCheck {
  const expected = entry.tones ?? [];
  if (expected.length === 0) return { correct: false, expected, wrongIndexes: [] };

  const wrongIndexes = expected
    .map((tone, index) => (attempt[index] === tone ? -1 : index))
    .filter((index) => index >= 0);

  // A longer attempt than the word has syllables is wrong even if the prefix
  // matches, and there is no position to blame it on beyond the overrun.
  const overrun = attempt.length > expected.length;

  return {
    correct: wrongIndexes.length === 0 && !overrun,
    expected,
    wrongIndexes,
  };
}

/**
 * Fold away everything that is not the answer.
 *
 * Case, surrounding space, the space between syllables that pinyin sometimes
 * carries and sometimes does not, and the punctuation a learner may copy in from
 * an example sentence. Unicode is normalised to NFC first so that a precomposed
 * ề and a composed one compare equal — they look identical and arrive from
 * different keyboards.
 */
function normalise(value: string): string {
  return value
    .normalize('NFC')
    .toLowerCase()
    .replace(/[\s　]+/g, '')
    .replace(/[.,!?;:'"·、。，！？；：「」『』()（）]/g, '')
    .trim();
}

/**
 * Strip combining marks, so `hỏi` and `hoi` compare equal.
 *
 * Decomposing first is what makes this work across both tonal languages at once:
 * Vietnamese tone marks and the horn on ơ/ư, and pinyin's macrons and carons, all
 * become combining characters in the U+0300–U+036F block once the string is NFD.
 */
function stripMarks(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}
