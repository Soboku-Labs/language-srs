import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react';
import {
  getLanguageTheme,
  getToneColor,
  getToneColors,
  type LanguageCode,
  type LanguageTheme,
  type ThemeMode,
} from '@language-srs/core';

/**
 * The Suboku system, as CSS.
 *
 * The palettes themselves stay in `@language-srs/core` — they are shared with the
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
  /**
   * The palette's own mode, not the operating system's preference.
   *
   * Every theme in the core is `light`, and deliberately: "one room, four inks"
   * — the palettes share one paper ground and differ only in the accent, because
   * an earlier version with dark variants meant switching from Japanese to
   * Mandarin turned the lights off mid-session.
   *
   * This used to watch `prefers-color-scheme` and report that instead, which was
   * a listener doing nothing and a value that lied: it would have said `dark`
   * while every colour on screen stayed light.
   */
  mode: ThemeMode;
  theme: LanguageTheme;
  /** `theme.colors`, under the name the screens ask for. */
  palette: LanguageTheme['colors'];
  toneColor: (tone: number) => string;
}

const ThemeContext = createContext<ThemeValue | undefined>(undefined);

/**
 * The theme's colours, under the names the stylesheet already uses.
 *
 * The left side is `ThemeColors` from the core, which the native widgets share;
 * the right side is the custom property every CSS rule names. Keeping the
 * mapping in one table means the stylesheet never has to learn that the core
 * calls the page colour `background` while the rules call it `--canvas`.
 */
const VARIABLES: Record<string, string> = {
  background: '--canvas',
  surface: '--surface',
  surfaceRaised: '--surface-raised',
  border: '--line',
  text: '--ink',
  textMuted: '--ink-muted',
  textFaint: '--ink-faint',
  accent: '--accent',
  accentSoft: '--accent-soft',
  secondary: '--secondary',
  again: '--again',
  hard: '--hard',
  good: '--good',
  easy: '--easy',
  success: '--positive',
  warning: '--caution',
  danger: '--critical',
};

export function ThemeProvider({
  languageCode,
  children,
}: {
  languageCode: LanguageCode;
  children: ReactNode;
}) {
  const theme = useMemo(() => getLanguageTheme(languageCode), [languageCode]);

  useEffect(() => {
    const root = document.documentElement;
    const colors = theme.colors as unknown as Record<string, string>;
    for (const [key, variable] of Object.entries(VARIABLES)) {
      const value = colors[key];
      if (value) root.style.setProperty(variable, value);
    }

    // On a tone card the colour *is* the answer, so these are stated per
    // language rather than derived from the accent.
    getToneColors(theme).forEach((colour, index) =>
      root.style.setProperty(`--tone-${index + 1}`, colour),
    );

    root.style.setProperty('--radius-card', `${theme.radius.card}px`);
    root.style.setProperty('--radius-control', `${theme.radius.control}px`);
    root.style.setProperty('--radius-pill', `${theme.radius.pill}px`);
    // So form controls and scrollbars match the theme rather than the OS default.
    root.style.colorScheme = theme.mode;
  }, [theme]);

  const value = useMemo<ThemeValue>(
    () => ({
      languageCode,
      mode: theme.mode,
      theme,
      palette: theme.colors,
      toneColor: (tone: number) => getToneColor(theme, tone),
    }),
    [languageCode, theme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeValue {
  const context = useContext(ThemeContext);
  if (!context) throw new Error('useTheme must be used inside a ThemeProvider');
  return context;
}
