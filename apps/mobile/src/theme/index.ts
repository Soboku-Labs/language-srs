/**
 * Layout tokens for the Suboku system.
 *
 * Colours and radii come from `@language-srs/core`; this is the geometry.
 *
 * The scale is tighter than the version it replaced. Restraint in a type system
 * comes from using fewer sizes, not from making them smaller — six steps that are
 * clearly different beats nine that are nearly the same, because the reader can
 * actually tell the levels apart.
 */
export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 20,
  xl: 28,
  xxl: 44,
} as const;

export const typography = {
  /**
   * Target-language text is set large deliberately. Tone marks, kanji strokes and
   * the difference between hỏi and ngã do not survive body size, and a learner
   * squinting at a diacritic is not studying it.
   */
  target: 46,
  targetSmall: 28,
  /** The one oversized number on the dashboard. */
  display: 68,
  title: 22,
  heading: 17,
  body: 15,
  caption: 13,
  micro: 11,
} as const;

/**
 * Weights.
 *
 * Two, not five. Hierarchy is carried by size and space; adding weight on top of
 * both is the thing that makes an interface look busy while every individual
 * decision seemed reasonable.
 */
export const weight = {
  regular: '400',
  medium: '500',
  strong: '600',
} as const;

export { ThemeProvider, useTheme, useThemedStyles } from './ThemeProvider';
export type { ResolvedTheme } from './ThemeProvider';
