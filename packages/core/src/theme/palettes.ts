import type { CardKind } from '../types/exam';
import type { LanguageCode } from '../types/language';

/**
 * Four themed front ends over one shared core.
 *
 * Each language gets a visual identity drawn from its own material culture rather
 * than from its flag — flags make four apps that differ only in a hue, which is
 * not a different front end, it is a recolour. The references here are surfaces a
 * learner of that language actually encounters: ink and cinnabar seals for
 * Mandarin, washi paper and indigo for Japanese, dancheong pigments for Korean,
 * lacquer and gold leaf for Vietnamese.
 *
 * Two of them are light and two are dark, and the corner radii and type weights
 * differ, so switching language changes the feel of the app rather than its
 * accent colour.
 *
 * Why this lives in core rather than in the app:
 *
 * The home-screen widgets render in their own processes, in Swift and Kotlin.
 * If the palettes lived in the React layer, each theme would exist three times and
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

  /** Primary action and progress colour. */
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
  /** Theme name shown in settings, e.g. "Ink and cinnabar". */
  name: string;
  /** One line on where the palette comes from. */
  inspiration: string;
  mode: ThemeMode;
  colors: ThemeColors;
  radius: ThemeRadius;
  /** Letter spacing on headings; part of what makes each theme feel distinct. */
  headingLetterSpacing: number;
  /** Weight for headings, as a React Native fontWeight string. */
  headingWeight: '500' | '600' | '700' | '800';
  /**
   * One colour per card kind.
   *
   * Stated per theme for the same reason as `toneRamp`. Deriving these from the
   * semantic colours looked tidy and was wrong: a theme legitimately reuses a hue
   * across roles — in the washi palette the accent and the Easy button are both
   * indigo — so a derived mapping renders "Meaning" and "Listening" in the same
   * colour in the session-mix legend, where the whole point is telling them apart.
   */
  kindRamp: Record<CardKind, string>;
  /**
   * One colour per tone, for tonal languages only.
   *
   * Stated explicitly rather than derived from the semantic colours. On a tone
   * card the colour *is* the answer, so two tones sharing a hue is a broken
   * exercise, not a cosmetic issue — and semantic roles legitimately reuse hues
   * (a theme's danger and accent are both cinnabar red in the Mandarin palette),
   * so deriving a ramp from them collides by construction.
   */
  toneRamp?: string[];
}

/**
 * Mandarin — ink on paper, with a cinnabar seal.
 *
 * Dark, because the reference is ink wash on a dark ground rather than the paper
 * itself. Corners are nearly square: seals, scroll ends and the character grid a
 * learner writes in are all rectilinear.
 */
const MANDARIN_THEME: LanguageTheme = {
  languageCode: 'zh',
  name: 'Ink and cinnabar',
  inspiration: 'Sumi ink, cinnabar seal paste and gold on lacquer.',
  mode: 'dark',
  colors: {
    background: '#14100E',
    surface: '#201A17',
    surfaceRaised: '#2B2320',
    border: '#3A302B',

    text: '#F5F0E6',
    textMuted: '#B3A695',
    textFaint: '#7C7062',

    accent: '#C8102E',
    accentSoft: '#3A1219',
    secondary: '#D4AF37',

    again: '#C8102E',
    hard: '#D4AF37',
    good: '#6FA287',
    easy: '#C8A25B',

    success: '#6FA287',
    warning: '#D4AF37',
    danger: '#C8102E',
  },
  kindRamp: {
    // Lighter than the cinnabar accent: true cinnabar is dark enough that it
    // falls below 3:1 against the ink surface, which is fine for a filled button
    // but not for a legend dot and its label.
    recognition: '#D93A54',
    production: '#D4AF37',
    listening: '#7B9FD4',
    reading: '#6FA287',
    writing: '#E08A3C',
    grammar: '#B07AA1',
    tone: '#E5C76B',
    script: '#64B6AC',
  },
  radius: { card: 6, control: 4, pill: 999 },
  headingLetterSpacing: 0.5,
  headingWeight: '700',
  // 1 high level, 2 rising, 3 falling-rising, 4 falling, 5 neutral.
  toneRamp: ['#C8102E', '#D4AF37', '#6FA287', '#7B9FD4', '#7C7062'],
};

/**
 * Japanese — washi paper and indigo.
 *
 * Light and rectilinear. Vermilion appears only where something needs to be
 * noticed, the way it does on a torii or a hanko, so it carries the Again button
 * and nothing else.
 */
const JAPANESE_THEME: LanguageTheme = {
  languageCode: 'ja',
  name: 'Washi and indigo',
  inspiration: 'Washi paper, aizome indigo and vermilion.',
  mode: 'light',
  colors: {
    background: '#FAF6EF',
    surface: '#FFFFFF',
    surfaceRaised: '#F2ECE1',
    border: '#E0D7C7',

    text: '#1C1A17',
    textMuted: '#5F5849',
    textFaint: '#918875',

    accent: '#1B3B6F',
    accentSoft: '#E3E9F4',
    secondary: '#E24A33',

    again: '#E24A33',
    hard: '#C98A24',
    good: '#2E7D62',
    easy: '#1B3B6F',

    success: '#2E7D62',
    warning: '#C98A24',
    danger: '#E24A33',
  },
  kindRamp: {
    recognition: '#1B3B6F',
    production: '#C23B26',
    listening: '#26668C',
    reading: '#2E7D62',
    writing: '#8A5A16',
    grammar: '#6E4285',
    tone: '#7A5C30',
    script: '#5E4335',
  },
  radius: { card: 4, control: 4, pill: 999 },
  headingLetterSpacing: 0,
  headingWeight: '600',
};

/**
 * Korean — dancheong pigments on hanji.
 *
 * Light and cool, and the most rounded of the four: the reference is moon jars
 * and the curves of dancheong eaves rather than anything rectilinear. Cobalt
 * leads, jade supports, and taegeuk red is reserved for failure.
 */
const KOREAN_THEME: LanguageTheme = {
  languageCode: 'ko',
  name: 'Dancheong on hanji',
  inspiration: 'Dancheong temple pigments, celadon jade and hanji paper.',
  mode: 'light',
  colors: {
    background: '#F1F4F6',
    surface: '#FFFFFF',
    surfaceRaised: '#E7EDF1',
    border: '#D3DEE5',

    text: '#12202B',
    textMuted: '#4E6273',
    textFaint: '#8298A8',

    accent: '#0B4F9E',
    accentSoft: '#DCE8F6',
    secondary: '#1F8A70',

    again: '#CD2E3A',
    hard: '#D98324',
    good: '#1F8A70',
    easy: '#0B4F9E',

    success: '#1F8A70',
    warning: '#D98324',
    danger: '#CD2E3A',
  },
  kindRamp: {
    recognition: '#0B4F9E',
    production: '#A33B29',
    listening: '#6B4494',
    reading: '#15705B',
    writing: '#8F5514',
    grammar: '#A83358',
    tone: '#6F5729',
    script: '#265E78',
  },
  radius: { card: 16, control: 12, pill: 999 },
  headingLetterSpacing: -0.2,
  headingWeight: '700',
};

/**
 * Vietnamese — son mai lacquer with gold leaf.
 *
 * Dark, warm and red-brown rather than black; the depth in lacquerware comes from
 * layers over a red ground. Gold leads because it is what the eye goes to on a
 * lacquer panel, and it doubles as the tone-drill accent for a language where
 * tones carry most of the difficulty.
 */
const VIETNAMESE_THEME: LanguageTheme = {
  languageCode: 'vi',
  name: 'Lacquer and gold leaf',
  inspiration: 'Son mai lacquerware, gold leaf and lotus.',
  mode: 'dark',
  colors: {
    background: '#1A0F0C',
    surface: '#2A1A14',
    surfaceRaised: '#372219',
    border: '#4A2E22',

    text: '#F7EFE4',
    textMuted: '#C0A88F',
    textFaint: '#8B7259',

    accent: '#E4A11B',
    accentSoft: '#3E2A11',
    secondary: '#E8919C',

    again: '#DA251D',
    hard: '#E4A11B',
    good: '#7BAE7F',
    easy: '#E8919C',

    success: '#7BAE7F',
    warning: '#E4A11B',
    danger: '#DA251D',
  },
  kindRamp: {
    recognition: '#E4A11B',
    production: '#E8919C',
    listening: '#9BC4E2',
    reading: '#7BAE7F',
    writing: '#DA251D',
    grammar: '#C58AC7',
    tone: '#F5D76E',
    script: '#6FBFA8',
  },
  radius: { card: 12, control: 10, pill: 999 },
  headingLetterSpacing: 0.2,
  headingWeight: '600',
  // 1 ngang, 2 huyen, 3 sac, 4 hoi, 5 nga, 6 nang. Ngang is deliberately the
  // quietest: it is the unmarked tone, and colouring it loudly teaches the
  // opposite of how it looks on the page.
  toneRamp: ['#C0A88F', '#E8919C', '#E4A11B', '#7BAE7F', '#9BC4E2', '#DA251D'],
};

export const LANGUAGE_THEMES: Record<LanguageCode, LanguageTheme> = {
  zh: MANDARIN_THEME,
  ja: JAPANESE_THEME,
  ko: KOREAN_THEME,
  vi: VIETNAMESE_THEME,
};

export function getLanguageTheme(code: LanguageCode): LanguageTheme {
  const theme = LANGUAGE_THEMES[code];
  if (!theme) throw new Error(`No theme for language: ${code}`);
  return theme;
}

/**
 * Accent per card kind for a theme.
 *
 * Read straight off the theme's ramp. The session-mix legend on the dashboard
 * shows several kinds side by side, so these have to be distinguishable from each
 * other and legible on that theme's background — both of which are asserted in
 * `palettes.test.ts` rather than left to eyeballing four palettes.
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
