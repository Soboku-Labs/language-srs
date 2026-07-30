import React, { createContext, useContext, useMemo } from 'react';
import { StyleSheet } from 'react-native';
import {
  getCardKindColors,
  getLanguageTheme,
  getToneColor,
  type LanguageTheme,
} from '@language-srs/core';
import { useEngine } from '../engine/EngineProvider';

export interface ResolvedTheme extends LanguageTheme {
  /** Accent per card kind, derived once per theme. */
  kindColors: Record<string, string>;
  /** Colour for a tone number in this language, or plain text when non-tonal. */
  toneColor(tone: number): string;
}

const ThemeContext = createContext<ResolvedTheme | undefined>(undefined);

/**
 * Supplies the active language's theme.
 *
 * Keyed off `engine.activeLanguage`, so switching from Mandarin to Vietnamese
 * re-themes the whole app — light to dark, square corners to rounded, cinnabar to
 * gold — without any screen knowing a switch happened. Sits inside
 * `EngineProvider` because the language lives in the engine, which is also what
 * keeps the app and the home-screen widget showing the same theme: both read it
 * from the same place.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const { engine, revision } = useEngine();

  const value = useMemo<ResolvedTheme>(() => {
    const theme = getLanguageTheme(engine.activeLanguage);
    const kindColors = getCardKindColors(theme);
    return {
      ...theme,
      kindColors,
      toneColor: (tone: number) => getToneColor(theme, tone),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, revision, engine.activeLanguage]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ResolvedTheme {
  const theme = useContext(ThemeContext);
  if (!theme) throw new Error('useTheme must be used inside a ThemeProvider');
  return theme;
}

/**
 * Build a stylesheet from the active theme.
 *
 * `StyleSheet.create` is memoised per theme, so switching language rebuilds the
 * styles once rather than on every render — and screens keep writing ordinary
 * stylesheets instead of scattering inline colour objects through their JSX.
 */
export function useThemedStyles<T extends StyleSheet.NamedStyles<T>>(
  factory: (theme: ResolvedTheme) => T,
): T {
  const theme = useTheme();
  // The factory is redefined on every render by design — callers pass a module
  // -level function, so keying the memo on the theme alone is correct.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => StyleSheet.create(factory(theme)), [theme]);
}
