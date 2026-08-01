/**
 * Working out tones from the spelling.
 *
 * Both tonal languages in this app write their tones down, so the tone data does
 * not have to come from a source that happens to include it — it can be read off
 * the word. That matters because the tone drill is the one exercise where a
 * missing or wrong value produces a card that teaches the opposite of the truth.
 */

/**
 * Mandarin tones from numeric pinyin: "ai4 hao4" → [4, 4].
 *
 * The dataset gives both marked pinyin and the numeric form, and the numeric
 * form is the one worth parsing — deriving tones from the diacritics means
 * finding which vowel carries the mark, and the rules for that have exceptions.
 *
 * A syllable with no digit is the neutral tone, which this app numbers 5, in
 * line with how `LexicalEntry.tones` is documented and how the theme's tone ramp
 * is ordered.
 */
export function tonesFromNumericPinyin(numeric) {
  if (typeof numeric !== 'string' || numeric.trim().length === 0) return undefined;

  const tones = numeric
    .trim()
    .split(/\s+/)
    .map((syllable) => {
      const match = syllable.match(/([1-5])$/);
      return match ? Number(match[1]) : 5;
    });

  return tones.length > 0 ? tones : undefined;
}

/**
 * Vietnamese tones from the diacritics: "học" → [6], "tiếng Việt" → [3, 6].
 *
 * Decomposing to NFD separates the tone mark from the letter, which is what
 * makes this a lookup rather than a table of six hundred precomposed characters.
 * The catch is that Vietnamese uses two *kinds* of diacritic: tone marks, and
 * the letter-forming marks on ă, â, ê, ô, ơ and ư. Only the first kind is a
 * tone, so the breve, circumflex and horn are skipped rather than counted.
 *
 * Order matches `TONE_SYSTEMS.vi`: ngang, huyền, sắc, hỏi, ngã, nặng.
 */
const TONE_MARKS = new Map([
  ['\u0300', 2], // grave — huyền
  ['\u0301', 3], // acute — sắc
  ['\u0309', 4], // hook above — hỏi
  ['\u0303', 5], // tilde — ngã
  ['\u0323', 6], // dot below — nặng
]);

/** Letter-forming marks, which are part of the vowel rather than its tone. */
const LETTER_MARKS = new Set(['\u0306', '\u0302', '\u031b']);

export function tonesFromVietnamese(word) {
  if (typeof word !== 'string' || word.trim().length === 0) return undefined;

  const syllables = word.trim().split(/\s+/);
  const tones = syllables.map((syllable) => {
    for (const character of syllable.normalize('NFD')) {
      if (LETTER_MARKS.has(character)) continue;
      const tone = TONE_MARKS.get(character);
      if (tone) return tone;
    }
    // No mark at all is ngang, the unmarked tone.
    return 1;
  });

  return tones.length > 0 ? tones : undefined;
}

/** Whether a string is written in the Vietnamese alphabet and nothing else. */
export function isVietnameseWord(word) {
  return /^[a-zA-Zàáâãèéêìíòóôõùúýăđĩũơưạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹ\s-]+$/i.test(word);
}
