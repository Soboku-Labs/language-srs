import type { Card, LexicalEntry } from '../types/card';
import { MEANING_KINDS, type AnswerCheck } from './types';

/**
 * Checking a typed answer.
 *
 * The interesting cases are the near misses, and they are the reason this is not
 * a string comparison. A learner who writes `dien thoai` for `điện thoại` knows
 * the word and does not know the tones; one who writes `べんきょう` for `勉強`
 * knows the word and was asked for the written form. Both are a different event
 * from not knowing, and flattening them into "wrong" throws away the only
 * information worth giving back.
 *
 * They still count as failures for scheduling — the detail is part of the word —
 * but the learner is told which detail rather than just being marked down.
 */

/** Fold case, trim, collapse whitespace, and drop punctuation. */
export function normaliseAnswer(input: string): string {
  return input
    .normalize('NFC')
    .toLowerCase()
    .replace(/[.,!?;:'"()[\]{}·。，、！？；：（）「」『』]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Strip tone diacritics from Latin script.
 *
 * Vietnamese carries tone in the diacritics, so this is how "right letters, wrong
 * tones" is detected. `đ` is deliberately folded to `d` as well: it is a distinct
 * letter rather than a diacritic, but it is the same class of near miss.
 */
export function stripDiacritics(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .normalize('NFC');
}

/** Levenshtein distance, capped — the exact value stops mattering past a couple of edits. */
export function editDistance(a: string, b: string, cap = 3): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > cap) return cap + 1;

  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);

  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    let rowMin = i;

    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const value = Math.min(current[j - 1]! + 1, previous[j]! + 1, previous[j - 1]! + cost);
      current.push(value);
      rowMin = Math.min(rowMin, value);
    }

    // Every path through this row already exceeds the cap, so the final distance will too.
    if (rowMin > cap) return cap + 1;
    previous = current;
  }

  return previous[b.length]!;
}

/** The answers that would be accepted for a card, most canonical first. */
export function expectedAnswers(card: Card, entry: LexicalEntry): string[] {
  if (MEANING_KINDS.includes(card.kind)) return entry.meanings;
  return [entry.target, ...(entry.variants?.map((variant) => variant.form) ?? [])];
}

/**
 * Check a typed answer.
 *
 * Meaning answers are lenient about extra words — someone who types "to eat" for
 * "eat" knows it — so a containment match counts. Production answers are not:
 * the target form is the thing being learned, and "close enough" there is how you
 * end up confidently writing a word wrong.
 */
export function checkTypedAnswer(input: string, card: Card, entry: LexicalEntry): AnswerCheck {
  const typed = normaliseAnswer(input);
  const accepted = expectedAnswers(card, entry);
  const expected = accepted[0] ?? '';

  if (typed.length === 0) {
    return { quality: 'wrong', correct: false, expected };
  }

  const isMeaning = MEANING_KINDS.includes(card.kind);

  for (const candidate of accepted) {
    const target = normaliseAnswer(candidate);
    if (typed === target) return { quality: 'exact', correct: true, expected: candidate };

    if (isMeaning) {
      // "to eat" against "eat", or one gloss out of a comma-separated list.
      const parts = target.split(/\s*,\s*/);
      if (parts.includes(typed)) return { quality: 'exact', correct: true, expected: candidate };
      if (target.includes(typed) && typed.length >= 3) {
        return { quality: 'exact', correct: true, expected: candidate };
      }
    }
  }

  // Right letters, wrong tones. Only meaningful where tone lives in the diacritics.
  if (!isMeaning && entry.languageCode === 'vi') {
    for (const candidate of accepted) {
      if (stripDiacritics(typed) === stripDiacritics(normaliseAnswer(candidate))) {
        return {
          quality: 'close',
          correct: false,
          expected: candidate,
          note: 'Right letters, wrong tones.',
        };
      }
    }
  }

  // The reading instead of the written form — the commonest Japanese near miss.
  if (!isMeaning && normaliseAnswer(entry.reading) === typed && entry.reading !== entry.target) {
    return {
      quality: 'close',
      correct: false,
      expected,
      note: 'That is the reading — the answer wanted the written form.',
    };
  }

  // One typo away, for answers long enough that an edit is unlikely to be luck.
  for (const candidate of accepted) {
    const target = normaliseAnswer(candidate);
    if (target.length >= 4 && editDistance(typed, target, 1) <= 1) {
      return { quality: 'close', correct: false, expected: candidate, note: 'One character out.' };
    }
  }

  return { quality: 'wrong', correct: false, expected };
}
