import { describe, expect, it } from 'vitest';
import {
  LANGUAGE_CODES,
  cardKindsForLanguage,
  getLanguageProfile,
  usesCharacterWriting,
} from './language';

/**
 * A card kind a language cannot produce should not be offered.
 *
 * Found on the setup screen, which told a Japanese learner their programme
 * would include "the tones that make it land" and promised tone cards that
 * could never be generated.
 */
describe('card kinds a language actually has', () => {
  it('offers tone cards only to tonal languages', () => {
    for (const code of LANGUAGE_CODES) {
      const hasTone = cardKindsForLanguage(code).includes('tone');
      expect(hasTone).toBe(getLanguageProfile(code).tonal);
    }
  });

  it('knows Mandarin and Japanese are written in characters', () => {
    // The script ids are `hanzi-simplified` and `hanzi-traditional`, so an
    // equality check against 'hanzi' matched neither.
    expect(usesCharacterWriting('zh')).toBe(true);
    expect(usesCharacterWriting('ja')).toBe(true);
  });

  it('does not offer handwriting for a Latin-alphabet language', () => {
    expect(usesCharacterWriting('vi')).toBe(false);
    expect(cardKindsForLanguage('vi')).not.toContain('writing');
  });

  it('always leaves the kinds every language shares', () => {
    for (const code of LANGUAGE_CODES) {
      const kinds = cardKindsForLanguage(code);
      // Without these there is no deck at all, whatever the script.
      expect(kinds).toContain('recognition');
      expect(kinds).toContain('production');
      expect(kinds).toContain('listening');
    }
  });

  it('keeps them in one order', () => {
    for (const code of LANGUAGE_CODES) {
      const kinds = cardKindsForLanguage(code);
      expect([...kinds].sort()).toEqual([...new Set(kinds)].sort());
    }
  });
});
