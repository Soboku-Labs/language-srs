import type { LanguageCode } from '../types/language';

/**
 * The Suboku system.
 *
 * One neutral canvas, and exactly one variable: a single accent hue per language.
 *
 * This replaced four fully-realised culture palettes — ink and cinnabar, washi and
 * indigo, dancheong on hanji, lacquer and gold leaf — which were handsome and were
 * too much. Four palettes is four design systems to keep honest, four sets of
 * contrast to verify, and a product whose surface changes character depending on
 * which language you happen to be studying. The identity was carried almost
 * entirely by the accent anyway; the rest was decoration around it.
 *
 * So the reduction: the canvas is the same everywhere, near-white or near-black by
 * the reader's own system setting. Language moves one hue. Everything else —
 * neutrals, grade colours, semantic colours — is shared, defined once, and tested
 * once.
 *
 * Two things survive the cut, and the reason each survives is the same test:
 *
 *  - **Tone ramps.** On a tone card the colour *is* the answer. Removing it would
 *    remove the exercise, not the ornament.
 *  - **Grade colours.** Again and Easy have to be distinguishable at a glance and
 *    under a thumb, mid-session, without reading.
 *
 * Card-kind colour did not survive. Every kind chip already carries its name in
 * text, so the colour was restating a label — which is the definition of
 * decoration in this system.
 */

export type ThemeMode = 'light' | 'dark';

/** The colours available once a language and a mode have been resolved. */
export interface Palette {
  /** The page. */
  canvas: string;
  /** A surface sitting on the page. */
  surface: string;
  /** A surface sitting on a surface. */
  surfaceRaised: string;
  /** Hairline separators. Used sparingly; space is the preferred separator. */
  line: string;

  ink: string;
  inkMuted: string;
  inkFaint: string;

  /** The one colour that differs between languages. */
  accent: string;
  /** A wash of the accent, for tinted backgrounds. */
  accentSoft: string;
  /** Text colour that is legible on top of `accent`. */
  onAccent: string;

  /** Grade buttons, in rating order. Shared across languages. */
  again: string;
  hard: string;
  good: string;
  easy: string;

  positive: string;
  caution: string;
  critical: string;

  /** One colour per tone, or empty for a non-tonal language. */
  tones: string[];
}

export interface ThemeRadius {
  card: number;
  control: number;
  pill: number;
}

/**
 * Shared neutrals.
 *
 * Slightly warm rather than pure grey — a true #FFFFFF/#000000 pair reads as a
 * spec sheet, and these are surfaces meant to be looked at for an hour at a time.
 */
const NEUTRALS: Record<ThemeMode, Pick<Palette, 'canvas' | 'surface' | 'surfaceRaised' | 'line' | 'ink' | 'inkMuted' | 'inkFaint'>> = {
  light: {
    canvas: '#FCFCFB',
    surface: '#F4F4F1',
    surfaceRaised: '#EAEAE6',
    line: '#E2E2DD',
    ink: '#16161A',
    inkMuted: '#6B6B70',
    inkFaint: '#9A9A9E',
  },
  dark: {
    canvas: '#0C0C0D',
    surface: '#161618',
    surfaceRaised: '#202023',
    line: '#26262A',
    ink: '#F4F4F2',
    inkMuted: '#98989E',
    inkFaint: '#6A6A70',
  },
};

/**
 * Shared semantics.
 *
 * Muted on purpose. A saturated red for "Again" turns an ordinary part of studying
 * into an alarm, and you press it dozens of times a day.
 */
const SEMANTICS: Record<ThemeMode, Pick<Palette, 'again' | 'hard' | 'good' | 'easy' | 'positive' | 'caution' | 'critical'>> = {
  light: {
    again: '#B4342A',
    hard: '#A9762A',
    good: '#2E7D6B',
    easy: '#3B5B94',
    positive: '#2E7D6B',
    caution: '#A9762A',
    critical: '#B4342A',
  },
  dark: {
    again: '#E0665C',
    hard: '#D8A24A',
    good: '#58AE99',
    easy: '#7A9BD4',
    positive: '#58AE99',
    caution: '#D8A24A',
    critical: '#E0665C',
  },
};

interface AccentDefinition {
  /** Short name for the accent, shown once in settings. */
  name: string;
  light: string;
  dark: string;
  softLight: string;
  softDark: string;
  /** Ink colour on top of the accent, per mode. */
  onLight: string;
  onDark: string;
}

/**
 * One accent per language.
 *
 * Each is the single hue that survived from that language's original palette — the
 * cinnabar of a seal, aizome indigo, celadon, gold leaf — held at comparable
 * lightness so the four feel like one product rather than four skins.
 */
const ACCENTS: Record<LanguageCode, AccentDefinition> = {
  zh: {
    name: 'Cinnabar',
    light: '#B4342A',
    dark: '#E0665C',
    softLight: '#F5E7E5',
    softDark: '#2A1614',
    onLight: '#FFFFFF',
    onDark: '#1A0F0E',
  },
  ja: {
    name: 'Indigo',
    light: '#33538C',
    dark: '#8AA8DC',
    softLight: '#E6EBF4',
    softDark: '#141B29',
    onLight: '#FFFFFF',
    onDark: '#0D1220',
  },
  ko: {
    name: 'Celadon',
    light: '#2E7D6B',
    dark: '#68BCA6',
    softLight: '#E4F0EC',
    softDark: '#0F211D',
    onLight: '#FFFFFF',
    onDark: '#08201B',
  },
  vi: {
    name: 'Ochre',
    // Darker than the ochre used elsewhere in the ramp: at #A9762A a white label
    // on the primary button lands at 3.95:1, under the 4.5:1 bar. Darkening the
    // accent keeps white text — and so keeps all four buttons identical apart
    // from hue — rather than making this one language flip to dark text.
    light: '#96681F',
    dark: '#DDAA55',
    softLight: '#F5EDDF',
    softDark: '#241B0E',
    onLight: '#FFFFFF',
    onDark: '#20180A',
  },
};

/**
 * Tone ramps, per tonal language and per mode.
 *
 * Stated explicitly rather than derived. Semantic roles legitimately reuse a hue —
 * critical and the Mandarin accent are both a red — so a derived ramp collides by
 * construction, and two tones sharing a colour is a broken exercise rather than a
 * cosmetic slip. Distinctness and contrast are both asserted in the tests.
 *
 * Mandarin is 1-4 plus the neutral tone; Vietnamese is ngang, huyền, sắc, hỏi, ngã,
 * nặng. In both, the quietest tone gets the quietest colour: Mandarin's neutral and
 * Vietnamese's unmarked ngang are grey, because colouring them loudly teaches the
 * opposite of how they look on the page.
 */
const TONE_RAMPS: Partial<Record<LanguageCode, Record<ThemeMode, string[]>>> = {
  zh: {
    light: ['#B4342A', '#A9762A', '#2E7D6B', '#3B5B94', '#8A8A8F'],
    dark: ['#E0665C', '#D8A24A', '#58AE99', '#7A9BD4', '#86868B'],
  },
  vi: {
    light: ['#8A8A8F', '#A9762A', '#B4342A', '#2E7D6B', '#3B5B94', '#7A4A86'],
    dark: ['#86868B', '#D8A24A', '#E0665C', '#58AE99', '#7A9BD4', '#B48FC4'],
  },
};

/**
 * One radius scale for the whole product.
 *
 * Softly rounded, not pill-shaped. A fully-rounded primary button was the right
 * call when the brief was playful; under a studio that trades on restraint it reads
 * as a consumer app shouting. The pill radius survives only for the progress track,
 * where it is a capsule rather than a decision.
 */
export const RADIUS: ThemeRadius = { card: 14, control: 10, pill: 999 };

export interface LanguageTheme {
  languageCode: LanguageCode;
  /** Accent name, e.g. "Cinnabar". The whole of the per-language identity. */
  accentName: string;
  light: Palette;
  dark: Palette;
  radius: ThemeRadius;
}

function buildPalette(code: LanguageCode, mode: ThemeMode): Palette {
  const accent = ACCENTS[code];
  return {
    ...NEUTRALS[mode],
    ...SEMANTICS[mode],
    accent: mode === 'light' ? accent.light : accent.dark,
    accentSoft: mode === 'light' ? accent.softLight : accent.softDark,
    onAccent: mode === 'light' ? accent.onLight : accent.onDark,
    tones: TONE_RAMPS[code]?.[mode] ?? [],
  };
}

export const LANGUAGE_THEMES: Record<LanguageCode, LanguageTheme> = {
  zh: buildTheme('zh'),
  ja: buildTheme('ja'),
  ko: buildTheme('ko'),
  vi: buildTheme('vi'),
};

function buildTheme(code: LanguageCode): LanguageTheme {
  return {
    languageCode: code,
    accentName: ACCENTS[code].name,
    light: buildPalette(code, 'light'),
    dark: buildPalette(code, 'dark'),
    radius: RADIUS,
  };
}

export function getLanguageTheme(code: LanguageCode): LanguageTheme {
  const theme = LANGUAGE_THEMES[code];
  if (!theme) throw new Error(`No theme for language: ${code}`);
  return theme;
}

/** The palette for a language in a given mode. */
export function resolvePalette(code: LanguageCode, mode: ThemeMode): Palette {
  const theme = getLanguageTheme(code);
  return mode === 'dark' ? theme.dark : theme.light;
}

/** Tone colours for a language and mode, or an empty list for a non-tonal one. */
export function getToneColors(code: LanguageCode, mode: ThemeMode): string[] {
  return resolvePalette(code, mode).tones;
}

export function getToneColor(code: LanguageCode, mode: ThemeMode, tone: number): string {
  const palette = resolvePalette(code, mode);
  if (palette.tones.length === 0) return palette.ink;
  return palette.tones[(tone - 1) % palette.tones.length] ?? palette.inkMuted;
}
