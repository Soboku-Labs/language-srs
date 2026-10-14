import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  RADIUS,
  getToneColor,
  resolvePalette,
  type LanguageCode,
  type Palette,
  type ThemeMode,
} from '@mon/core';

/**
 * The Suboku system, as CSS.
 *
 * The palettes themselves stay in `@mon/core` — they are shared with the
 * native widgets, so they cannot live in a web app. What lives here is the
 * mapping onto custom properties, which is the part that is genuinely a browser
 * concern.
 *
 * Writing them onto `:root` rather than threading a theme object through props
 * means switching language repaints without re-rendering a single component, and
 * every stylesheet rule can name a colour directly instead of every component
 * having to be theme-aware.
 */

interface ThemeValue {
  languageCode: LanguageCode;
  mode: ThemeMode;
  palette: Palette;
  toneColor: (tone: number) => string;
}

const ThemeContext = createContext<ThemeValue | undefined>(undefined);

/** Follows the OS, and keeps following it if the setting changes mid-session. */
function useColorScheme(): ThemeMode {
  const [mode, setMode] = useState<ThemeMode>(() =>
    window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
  );

  useEffect(() => {
    const query = window.matchMedia?.('(prefers-color-scheme: dark)');
    if (!query) return;
    const onChange = (event: MediaQueryListEvent) => setMode(event.matches ? 'dark' : 'light');
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  return mode;
}

const VARIABLES: Record<keyof Omit<Palette, 'tones'>, string> = {
  canvas: '--canvas',
  surface: '--surface',
  surfaceRaised: '--surface-raised',
  line: '--line',
  ink: '--ink',
  inkMuted: '--ink-muted',
  inkFaint: '--ink-faint',
  accent: '--accent',
  accentSoft: '--accent-soft',
  onAccent: '--on-accent',
  again: '--again',
  hard: '--hard',
  good: '--good',
  easy: '--easy',
  positive: '--positive',
  caution: '--caution',
  critical: '--critical',
};

export function ThemeProvider({
  languageCode,
  children,
}: {
  languageCode: LanguageCode;
  children: ReactNode;
}) {
  const mode = useColorScheme();
  const palette = useMemo(() => resolvePalette(languageCode, mode), [languageCode, mode]);

  useEffect(() => {
    const root = document.documentElement;
    for (const [key, variable] of Object.entries(VARIABLES)) {
      root.style.setProperty(variable, palette[key as keyof typeof VARIABLES]);
    }
    palette.tones.forEach((colour, index) => root.style.setProperty(`--tone-${index + 1}`, colour));
    root.style.setProperty('--radius-card', `${RADIUS.card}px`);
    root.style.setProperty('--radius-control', `${RADIUS.control}px`);
    root.style.setProperty('--radius-pill', `${RADIUS.pill}px`);
    // So form controls and scrollbars match the palette rather than the OS default.
    root.style.colorScheme = mode;
  }, [palette, mode]);

  const value = useMemo<ThemeValue>(
    () => ({
      languageCode,
      mode,
      palette,
      toneColor: (tone: number) => getToneColor(languageCode, mode, tone),
    }),
    [languageCode, mode, palette],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeValue {
  const context = useContext(ThemeContext);
  if (!context) throw new Error('useTheme must be used inside a ThemeProvider');
  return context;
}
