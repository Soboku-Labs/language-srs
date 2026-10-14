import React, { createContext, useContext, useMemo } from 'react';
import { StyleSheet, useColorScheme } from 'react-native';
import {
  RADIUS,
  getLanguageTheme,
  getToneColor,
  resolvePalette,
  type Palette,
  type ThemeMode,
  type ThemeRadius,
} from '@mon/core';
import { useEngine } from '../engine/EngineProvider';

export interface ResolvedTheme {
  languageCode: string;
  /** Accent name, e.g. "Cinnabar". The whole per-language identity. */
  accentName: string;
  mode: ThemeMode;
  radius: ThemeRadius;
  colors: Palette;
  /** Colour for a tone number, or plain ink for a non-tonal language. */
  toneColor(tone: number): string;
}

const ThemeContext = createContext<ResolvedTheme | undefined>(undefined);

/**
 * Resolves the palette from two inputs: the reader's system appearance and the
 * active language.
 *
 * The split matters. Mode is the reader's decision and belongs to the OS —
 * an earlier version pinned light or dark *per language*, which meant switching
 * from Japanese to Mandarin turned the lights off whether or not that was wanted.
 * Language now moves one thing: the accent.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const { engine, revision } = useEngine();
  const scheme = useColorScheme();
  const mode: ThemeMode = scheme === 'dark' ? 'dark' : 'light';

  const value = useMemo<ResolvedTheme>(() => {
    const code = engine.activeLanguage;
    return {
      languageCode: code,
      accentName: getLanguageTheme(code).accentName,
      mode,
      radius: RADIUS,
      colors: resolvePalette(code, mode),
      toneColor: (tone: number) => getToneColor(code, mode, tone),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, revision, engine.activeLanguage, mode]);

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
 * Memoised per theme, so switching language or appearance rebuilds the styles once
 * rather than on every render — and screens keep writing ordinary stylesheets
 * instead of scattering inline colour objects through their JSX.
 */
export function useThemedStyles<T extends StyleSheet.NamedStyles<T>>(
  factory: (theme: ResolvedTheme) => T,
): T {
  const theme = useTheme();
  // The factory is a module-level function, so keying the memo on the theme alone
  // is correct.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => StyleSheet.create(factory(theme)), [theme]);
}
