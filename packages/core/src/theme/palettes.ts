import type { CardKind } from '../types/exam';
import type { LanguageCode } from '../types/language';

/**
 * One room, four inks.
 *
 * An earlier version of this file gave each language a complete visual identity —
 * two dark themes, two light, four corner radii, four sets of grade colours. It
 * was defensible on paper and heavy in the hand: switching from Japanese to
 * Mandarin turned the lights off, and a learner studying two languages had to
 * re-learn where things were every time they switched.
 *
 * So the palettes now share everything structural. One near-white paper ground,
 * one ink for text, one set of grade colours, one corner radius. What stays
 * per-language is a single accent — the ink you are writing in — plus the tone
 * ramp for the two tonal languages. Switching language changes the colour of the
 * pen, not the room.
 *
 * Why this lives in core rather than in the app:
 *
 * The home-screen widgets render in their own processes, in Swift and Kotlin. If
 * the palettes lived in the React layer, each theme would exist three times and
 * the Vietnamese widget would drift out of step with the Vietnamese app the first
 * time anyone adjusted a colour. Instead the themes are data here, they travel in
 * the widget payload, and the native widgets render whatever they are given. It is
 * the same rule as everything else on that boundary: the widget renders, it does
 * not decide.
 */

export type ThemeMode = 'light' | 'dark';

export interface ThemeColors {
  background: string;
  surface: string;
  surfaceRaised: string;
  border: string;

  text: string;
  textMuted: string;
  textFaint: string;

  /** Primary action and progress colour. The one thing that varies by language. */
  accent: string;
  /** Tinted background for accent-coloured chrome. */
  accentSoft: string;
  /** Secondary accent, used for highlights and the streak. */
  secondary: string;

  /** Grade buttons, in rating order. */
  again: string;
  hard: string;
  good: string;
  easy: string;

  success: string;
  warning: string;
  danger: string;
}

export interface ThemeRadius {
  card: number;
  control: number;
  pill: number;
}

export interface LanguageTheme {
  languageCode: LanguageCode;
  /** Theme name shown in settings, e.g. "Cinnabar". */
  name: string;
  /** One line on where the accent comes from. */
  inspiration: string;
  mode: ThemeMode;
  colors: ThemeColors;
  /** The same theme after dark. */
  dark: ThemeColors;
  radius: ThemeRadius;
  /** Letter spacing on headings. Shared; kept on the theme for the widgets. */
  headingLetterSpacing: number;
  /** Weight for headings, as a React Native fontWeight string. */
  headingWeight: '500' | '600' | '700' | '800';
  /**
   * One colour per card kind.
   *
   * Shared across the four themes, because a card kind means the same thing in
   * every language and the mix bar is read the same way. Stated as data rather
   * than derived from the semantic palette: a derived mapping reuses whatever hue
   * the accent happens to be and renders two kinds identically, which breaks the
   * one place the colour is doing the work.
   */
  kindRamp: Record<CardKind, string>;
  /**
   * One colour per tone, for tonal languages only.
   *
   * Stated explicitly rather than derived. On a tone card the colour *is* the
   * answer, so two tones sharing a hue is a broken exercise rather than a
   * cosmetic issue.
   */
  toneRamp?: string[];
}

/**
 * The shared ground.
 *
 * Warm near-white rather than pure white — a sheet of paper, not a lightbox — and
 * ink rather than black. Everything else on screen is measured against these.
 */
const PAPER = {
  background: '#FBFAF8',
  surface: '#FFFFFF',
  surfaceRaised: '#F3F1EC',
  border: '#E5E1D9',

  text: '#1B1A17',
  textMuted: '#6A655D',
  textFaint: '#8D877D',
} as const;

/**
 * Grade colours, shared by all four languages.
 *
 * These are a scale, not decoration: Again through Easy has to read the same way
 * every time, in every language, or the four buttons stop being muscle memory.
 */
/**
 * The same room at night.
 *
 * Not the light palette inverted — an inversion makes a bright wall out of
 * what was a dark line, and the whole point of this design is ink on paper.
 * These are the values of a dim room: a near-black that is warm rather than
 * blue, surfaces that lift by a few points rather than by a lot, and a border
 * that is visible without being a grid.
 */
const SLATE = {
  background: '#141311',
  surface: '#1C1B18',
  surfaceRaised: '#242220',
  border: '#332F2A',

  text: '#F2EFE9',
  textMuted: '#A7A098',
  textFaint: '#7D766D',
} as const;

const GRADES = {
  again: '#B4483C',
  hard: '#90681F',
  good: '#2F7A5F',
  easy: '#35618E',
} as const;

/**
 * One colour per card kind, shared by all four themes.
 *
 * Distinct from each other and legible on the paper ground — both asserted in
 * `palettes.test.ts` rather than left to eyeballing.
 */
const KIND_RAMP: Record<CardKind, string> = {
  recognition: '#2C4A7C',
  production: '#B03A2B',
  listening: '#6B4E9E',
  reading: '#14776A',
  writing: '#8E6A16',
  grammar: '#A2426B',
  tone: '#23718F',
  script: '#57606A',
};

const GEOMETRY: ThemeRadius = { card: 14, control: 10, pill: 999 };

interface InkOptions {
  code: LanguageCode;
  name: string;
  inspiration: string;
  /** The language's single accent. */
  accent: string;
  /** A pale wash of the accent, for chips and tinted chrome. */
  accentSoft: string;
  /** The same ink, chosen again to be legible on slate rather than on paper. */
  accentDark: string;
  /** A deep wash of the accent, for tinted chrome in the dark. */
  accentSoftDark: string;
  /** Used sparingly: the streak, and highlights that must not read as the accent. */
  secondary: string;
  secondaryDark: string;
  toneRamp?: string[];
}

/** Build a theme from the shared ground plus one language's ink. */
/**
 * Lift an accent off a dark ground.
 *
 * An ink chosen to sit on paper is too dark to read on slate: Indigo at
 * #2C4A7C against #141311 is almost invisible. Each language names its own
 * night accent rather than having one computed, because a mechanically
 * lightened colour drifts — Cinnabar lightens towards pink, Celadon towards
 * mint — and these four colours are the product's identity.
 */
function ink({
  code,
  name,
  inspiration,
  accent,
  accentSoft,
  accentDark,
  accentSoftDark,
  secondary,
  secondaryDark,
  toneRamp,
}: InkOptions): LanguageTheme {
  return {
    languageCode: code,
    name,
    inspiration,
    mode: 'light',
    colors: {
      ...PAPER,
      accent,
      accentSoft,
      secondary,
      ...GRADES,
      success: GRADES.good,
      warning: GRADES.hard,
      danger: GRADES.again,
    },
    /** The same theme after dark. Chosen by the app, not by the palette. */
    dark: {
      ...SLATE,
      accent: accentDark,
      accentSoft: accentSoftDark,
      secondary: secondaryDark,
      ...GRADES,
      success: GRADES.good,
      warning: GRADES.hard,
      danger: GRADES.again,
    },
    radius: GEOMETRY,
    headingLetterSpacing: -0.2,
    headingWeight: '600',
    kindRamp: KIND_RAMP,
    ...(toneRamp ? { toneRamp } : {}),
  };
}

export const LANGUAGE_THEMES: Record<LanguageCode, LanguageTheme> = {
  zh: ink({
    code: 'zh',
    name: 'Cinnabar',
    inspiration: 'The red of a seal, stamped once on a page of black ink.',
    accent: '#B03A2B',
    accentSoft: '#F7EAE7',
    accentDark: '#E2705E',
    accentSoftDark: '#2E1E1B',
    secondary: '#8E6A16',
    secondaryDark: '#D0A84A',
    // 1 high level, 2 rising, 3 falling-rising, 4 falling, 5 neutral. The neutral
    // tone is deliberately the quietest: it is the unstressed one.
    toneRamp: ['#2C4A7C', '#14776A', '#8E6A16', '#B03A2B', '#7C766C'],
  }),
  ja: ink({
    code: 'ja',
    name: 'Indigo',
    inspiration: 'Aizome indigo, the working colour of everyday cloth.',
    accent: '#2C4A7C',
    accentSoft: '#E9EDF6',
    accentDark: '#7FA3DC',
    accentSoftDark: '#1A2133',
    secondary: '#B4483C',
    secondaryDark: '#E2705E',
  }),
  ko: ink({
    code: 'ko',
    name: 'Celadon',
    inspiration: 'The green-blue glaze of Goryeo celadon.',
    accent: '#14776A',
    accentSoft: '#E2F1EE',
    accentDark: '#5FBFAC',
    accentSoftDark: '#152A28',
    secondary: '#35618E',
    secondaryDark: '#7FA3DC',
  }),
  vi: ink({
    code: 'vi',
    name: 'Gold leaf',
    inspiration: 'Gold leaf laid over sơn mài lacquer.',
    accent: '#8E6A16',
    accentSoft: '#F5EEDD',
    accentDark: '#D9B05C',
    accentSoftDark: '#2B2414',
    secondary: '#A34A5E',
    secondaryDark: '#D98A9B',
    // 1 ngang, 2 huyền, 3 sắc, 4 hỏi, 5 ngã, 6 nặng. Ngang leads quietly for the
    // same reason as the Mandarin neutral tone: it is the unmarked one, and
    // colouring it loudly teaches the opposite of how it looks on the page.
    toneRamp: ['#7C766C', '#2C4A7C', '#B03A2B', '#8E6A16', '#6B4E9E', '#14776A'],
  }),
};

export function getLanguageTheme(code: LanguageCode): LanguageTheme {
  const theme = LANGUAGE_THEMES[code];
  if (!theme) throw new Error(`No theme for language: ${code}`);
  return theme;
}

/**
 * Accent per card kind for a theme.
 *
 * Read straight off the theme's ramp. The dashboard's mix bar shows several kinds
 * side by side with nothing but colour to tell them apart, so these have to be
 * distinguishable from each other and legible on the ground — both of which are
 * asserted in `palettes.test.ts`.
 */
export function getCardKindColors(theme: LanguageTheme): Record<CardKind, string> {
  return theme.kindRamp;
}

/**
 * Tone colours for a theme, or an empty list for a non-tonal language.
 *
 * Only Mandarin and Vietnamese have a ramp. Japanese and Korean return nothing,
 * and the UI falls back to plain text rather than colouring syllables against
 * tones that do not exist.
 */
export function getToneColors(theme: LanguageTheme): string[] {
  return theme.toneRamp ?? [];
}

export function getToneColor(theme: LanguageTheme, tone: number): string {
  const palette = getToneColors(theme);
  if (palette.length === 0) return theme.colors.text;
  return palette[(tone - 1) % palette.length] ?? theme.colors.textMuted;
}
