import type { LanguageCode } from '../types/language';

/**
 * Where each language is spoken, said with some affection.
 *
 * The app had four languages and no sense of place: a flag emoji, a code, and a
 * word list. But nobody learns Vietnamese because it is ISO 639-1 `vi` — they
 * learn it because of a street in Hanoi, or a grandmother, or a plan. Naming the
 * place is the cheapest way for the interface to acknowledge that, and it costs
 * one line per language.
 *
 * This is data in core rather than strings in a component for the usual reason:
 * the landing page, the dashboard and eventually the widget all want the same
 * two words, and three copies would be three chances to spell Hà Nội wrong.
 */
export interface CultureProfile {
  languageCode: LanguageCode;
  /** Country in English, e.g. "Vietnam". */
  country: string;
  /** Country as written there, e.g. "Việt Nam". */
  countryLocal: string;
  /** The city the app pictures when it pictures the language. */
  city: string;
  cityLocal: string;
  /**
   * One line about the place, not the language.
   *
   * Written to be read once and then lived with, so nothing that becomes tiring
   * on the fortieth morning: no exclamation marks, no adjectives doing work the
   * noun could do.
   */
  line: string;
  /** Which motif the app draws for this language. See `LanguageArt`. */
  motif: 'pagoda' | 'torii' | 'hanok' | 'junk';
}

export const CULTURE_PROFILES: Record<LanguageCode, CultureProfile> = {
  zh: {
    languageCode: 'zh',
    country: 'China',
    countryLocal: '中国',
    city: 'Beijing',
    cityLocal: '北京',
    line: 'Grey brick hutong, a red seal on white paper, and tea that is refilled before you ask.',
    motif: 'pagoda',
  },
  ja: {
    languageCode: 'ja',
    country: 'Japan',
    countryLocal: '日本',
    city: 'Kyoto',
    cityLocal: '京都',
    line: 'A torii every few hundred metres, and a mountain at the end of the street.',
    motif: 'torii',
  },
  ko: {
    languageCode: 'ko',
    country: 'South Korea',
    countryLocal: '대한민국',
    city: 'Seoul',
    cityLocal: '서울',
    line: 'Tiled hanok eaves under glass towers, and a moon jar in a museum that draws a queue.',
    motif: 'hanok',
  },
  vi: {
    languageCode: 'vi',
    country: 'Vietnam',
    countryLocal: 'Việt Nam',
    city: 'Hanoi',
    cityLocal: 'Hà Nội',
    line: 'Limestone islands in the bay, a low plastic stool on the pavement, coffee with condensed milk.',
    motif: 'junk',
  },
};

export function getCulture(code: LanguageCode): CultureProfile {
  const culture = CULTURE_PROFILES[code];
  if (!culture) throw new Error(`No culture profile for language: ${code}`);
  return culture;
}

/** "Hà Nội · Việt Nam" — the place, in its own language first. */
export function describePlace(code: LanguageCode): string {
  const culture = getCulture(code);
  return `${culture.cityLocal} · ${culture.countryLocal}`;
}
