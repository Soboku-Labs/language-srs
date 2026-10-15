import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  type Appearance,
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
  /** Whether the app is currently dark, however that was decided. */
  dark: boolean;
  /**
   * The resolved colours of *another* language.
   *
   * The door shows four languages at once, none of which is necessarily the
   * active one, so every one of them needs its own palette resolved for the
   * mode the app is in. Without this the scenes kept their paper washes after
   * dark and the windows faded to pale grey at the bottom.
   */
  colorsFor: (code: LanguageCode) => LanguageTheme['colors'];
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

/**
 * Whether the device is asking for dark, watched rather than read once.
 *
 * Somebody whose phone flips at sunset should not have to reload to see it,
 * and on a laptop the setting can change while the app is open.
 */
function useSystemDark(): boolean {
  const [dark, setDark] = useState(
    () => window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false,
  );

  useEffect(() => {
    const query = window.matchMedia?.('(prefers-color-scheme: dark)');
    if (!query) return;

    const onChange = (event: MediaQueryListEvent) => setDark(event.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  return dark;
}

export function ThemeProvider({
  languageCode,
  appearance = 'system',
  children,
}: {
  languageCode: LanguageCode;
  appearance?: Appearance;
  children: ReactNode;
}) {
  const theme = useMemo(() => getLanguageTheme(languageCode), [languageCode]);
  const systemDark = useSystemDark();
  const dark = appearance === 'system' ? systemDark : appearance === 'dark';

  useEffect(() => {
    const root = document.documentElement;
    const colors = (dark ? theme.dark : theme.colors) as unknown as Record<string, string>;
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
    root.style.colorScheme = dark ? 'dark' : 'light';

    /*
     * The canvas colour goes on the root, not only on the body.
     *
     * Declaring support for both schemes makes the browser paint a dark canvas
     * on the root when the device is dark. That stops the body's background
     * propagating, so the body painted only its own box — one viewport tall —
     * and everything scrolled past it showed the UA's black through. The
     * footer was unreadable and the cause was nowhere near the footer.
     */
    root.style.background = colors.background ?? '';
    root.dataset.appearance = dark ? 'dark' : 'light';
  }, [theme, dark]);

  const value = useMemo<ThemeValue>(
    () => ({
      languageCode,
      mode: dark ? 'dark' : 'light',
      dark,
      colorsFor: (code: LanguageCode) => {
        const other = getLanguageTheme(code);
        return dark ? other.dark : other.colors;
      },
      theme,
      palette: dark ? theme.dark : theme.colors,
      toneColor: (tone: number) => getToneColor(theme, tone),
    }),
    [languageCode, theme, dark],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeValue {
  const context = useContext(ThemeContext);
  if (!context) throw new Error('useTheme must be used inside a ThemeProvider');
  return context;
}
