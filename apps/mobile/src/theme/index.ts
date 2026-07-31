/**
 * Layout tokens, shared by all four themes.
 *
 * Colours and corner radii come from the active language's theme in
 * `@language-srs/core` — see `ThemeProvider.tsx`. What is left here is the
 * geometry that should not change between languages: spacing rhythm and type
 * scale. Four themes that also disagreed about spacing would be four apps to
 * maintain rather than one app with four skins.
 */
export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const typography = {
  /**
   * Target-language text is set large deliberately. Tone marks, kanji strokes and
   * the difference between hỏi and ngã do not survive being set at body size, and
   * a learner squinting at a diacritic is not studying it.
   */
  target: 44,
  targetSmall: 30,
  title: 24,
  heading: 18,
  body: 15,
  caption: 13,
  micro: 11,
} as const;

export { ThemeProvider, useTheme, useThemedStyles } from './ThemeProvider';
export type { ResolvedTheme } from './ThemeProvider';
