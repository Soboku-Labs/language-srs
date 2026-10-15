import { describe, expect, it } from 'vitest';
import { CARD_KINDS } from '../types/exam';
import { LANGUAGE_CODES, getLanguageProfile } from '../types/language';
import { BRAND, LANGUAGE_THEMES, getCardKindColors, getLanguageTheme, getToneColor, getToneColors } from './palettes';

const HEX = /^#[0-9A-Fa-f]{6}$/;

/**
 * Relative luminance, per WCAG.
 *
 * Used to check that text is actually readable on its background in all four
 * themes. Four hand-picked palettes is exactly the situation where one of them
 * quietly ends up with grey-on-grey body text, and it is not something the type
 * system can catch.
 */
function luminance(hex: string): number {
  const channels = [1, 3, 5].map((offset) => {
    const value = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrast(foreground: string, background: string): number {
  const a = luminance(foreground);
  const b = luminance(background);
  const [lighter, darker] = a > b ? [a, b] : [b, a];
  return (lighter + 0.05) / (darker + 0.05);
}

describe('language themes', () => {
  it('provides a theme for every supported language', () => {
    for (const code of LANGUAGE_CODES) {
      expect(getLanguageTheme(code).languageCode).toBe(code);
    }
  });

  it('uses well-formed hex for every colour', () => {
    for (const theme of Object.values(LANGUAGE_THEMES)) {
      for (const [name, value] of Object.entries(theme.colors)) {
        expect(value, `${theme.languageCode}.${name}`).toMatch(HEX);
      }
    }
  });

  it('keeps body text readable against its background in every theme', () => {
    for (const theme of Object.values(LANGUAGE_THEMES)) {
      // WCAG AA for normal text.
      expect(contrast(theme.colors.text, theme.colors.background), theme.languageCode).toBeGreaterThan(4.5);
      expect(contrast(theme.colors.text, theme.colors.surface), theme.languageCode).toBeGreaterThan(4.5);
    }
  });

  it('keeps muted text readable, at least to the large-text threshold', () => {
    for (const theme of Object.values(LANGUAGE_THEMES)) {
      expect(contrast(theme.colors.textMuted, theme.colors.background), theme.languageCode).toBeGreaterThan(3);
    }
  });

  it('declares a mode that matches the actual lightness of the background', () => {
    for (const theme of Object.values(LANGUAGE_THEMES)) {
      const isLight = luminance(theme.colors.background) > 0.4;
      expect(isLight, theme.languageCode).toBe(theme.mode === 'light');
    }
  });

  it('gives the four themes genuinely different accents, not one hue recoloured', () => {
    const accents = Object.values(LANGUAGE_THEMES).map((theme) => theme.colors.accent);
    expect(new Set(accents).size).toBe(4);
  });

  /**
   * The point of the rewrite. Switching language used to turn the lights off —
   * two themes were dark — and move every corner radius, which made studying two
   * languages feel like using two apps. Everything structural is now shared, and
   * these assertions are what stop it drifting apart again.
   */
  it('shares one ground across all four languages', () => {
    const themes = Object.values(LANGUAGE_THEMES);
    for (const key of ['background', 'surface', 'surfaceRaised', 'border', 'text', 'textMuted', 'textFaint'] as const) {
      expect(new Set(themes.map((theme) => theme.colors[key])).size, key).toBe(1);
    }
    expect(new Set(themes.map((theme) => theme.mode))).toEqual(new Set(['light']));
  });

  it('shares one geometry and one type treatment', () => {
    const themes = Object.values(LANGUAGE_THEMES);
    expect(new Set(themes.map((theme) => theme.radius.card)).size).toBe(1);
    expect(new Set(themes.map((theme) => theme.radius.control)).size).toBe(1);
    expect(new Set(themes.map((theme) => theme.headingWeight)).size).toBe(1);
    expect(new Set(themes.map((theme) => theme.headingLetterSpacing)).size).toBe(1);
  });

  it('separates the four grade colours within each theme', () => {
    for (const theme of Object.values(LANGUAGE_THEMES)) {
      const grades = [theme.colors.again, theme.colors.hard, theme.colors.good, theme.colors.easy];
      expect(new Set(grades).size, theme.languageCode).toBe(4);
    }
  });

  /**
   * Again through Easy is a scale, and a scale that changes colour between
   * languages stops being muscle memory for anyone studying more than one.
   */
  it('uses the same grade scale in every language', () => {
    const scales = Object.values(LANGUAGE_THEMES).map((theme) =>
      [theme.colors.again, theme.colors.hard, theme.colors.good, theme.colors.easy].join(),
    );
    expect(new Set(scales).size).toBe(1);
  });

  it('keeps grade labels readable on the surface they sit on', () => {
    for (const theme of Object.values(LANGUAGE_THEMES)) {
      for (const grade of ['again', 'hard', 'good', 'easy'] as const) {
        // Grade labels are set in the grade's own colour on a wash of it.
        expect(contrast(theme.colors[grade], theme.colors.surface), grade).toBeGreaterThan(4.5);
      }
    }
  });

  /**
   * The accent carries text as well as filled buttons — the secondary actions on
   * every screen are accent-coloured labels on the ground, so it is held to the
   * body-text threshold rather than the large-text one.
   */
  it('keeps each accent readable as text on the ground', () => {
    for (const theme of Object.values(LANGUAGE_THEMES)) {
      expect(contrast(theme.colors.accent, theme.colors.background), theme.languageCode).toBeGreaterThan(4.5);
      expect(contrast(theme.colors.secondary, theme.colors.background), theme.languageCode).toBeGreaterThan(4.5);
    }
  });

  it('keeps the accent wash pale enough to carry text', () => {
    for (const theme of Object.values(LANGUAGE_THEMES)) {
      expect(contrast(theme.colors.text, theme.colors.accentSoft), theme.languageCode).toBeGreaterThan(4.5);
    }
  });
});

describe('card kind colours', () => {
  it('maps every card kind to a colour in every theme', () => {
    for (const theme of Object.values(LANGUAGE_THEMES)) {
      const kindColors = getCardKindColors(theme);
      for (const kind of CARD_KINDS) {
        expect(kindColors[kind], `${theme.languageCode}.${kind}`).toMatch(HEX);
      }
    }
  });

  /**
   * The dashboard's session-mix legend puts these side by side with only a
   * coloured dot to tell them apart, so two kinds sharing a colour makes the
   * legend unreadable. An earlier version derived these from the semantic
   * palette and produced exactly that.
   */
  it('gives every card kind a distinct colour within a theme', () => {
    for (const theme of Object.values(LANGUAGE_THEMES)) {
      const values = CARD_KINDS.map((kind) => getCardKindColors(theme)[kind]);
      expect(new Set(values).size, theme.languageCode).toBe(CARD_KINDS.length);
    }
  });

  it('keeps every card kind colour legible on its theme background', () => {
    for (const theme of Object.values(LANGUAGE_THEMES)) {
      const kindColors = getCardKindColors(theme);
      for (const kind of CARD_KINDS) {
        expect(
          contrast(kindColors[kind], theme.colors.background),
          `${theme.languageCode}.${kind}`,
        ).toBeGreaterThan(3);
      }
    }
  });

  it('uses the same kind colours in every language', () => {
    const ramps = Object.values(LANGUAGE_THEMES).map((theme) =>
      CARD_KINDS.map((kind) => getCardKindColors(theme)[kind]).join(),
    );
    expect(new Set(ramps).size).toBe(1);
  });

  it('keeps card kind colours legible on the surface they sit on', () => {
    for (const theme of Object.values(LANGUAGE_THEMES)) {
      const kindColors = getCardKindColors(theme);
      for (const kind of CARD_KINDS) {
        expect(
          contrast(kindColors[kind], theme.colors.surface),
          `${theme.languageCode}.${kind}`,
        ).toBeGreaterThan(3);
      }
    }
  });
});

describe('derived colours', () => {

  it('gives tonal languages one colour per tone and non-tonal ones none', () => {
    for (const code of LANGUAGE_CODES) {
      const profile = getLanguageProfile(code);
      const theme = getLanguageTheme(code);
      expect(getToneColors(theme), code).toHaveLength(profile.tonal ? profile.toneCount : 0);
    }
  });

  it('gives each tone a distinct colour, since the colour is the answer', () => {
    for (const code of ['zh', 'vi'] as const) {
      const colors = getToneColors(getLanguageTheme(code));
      expect(new Set(colors).size, code).toBe(colors.length);
    }
  });

  it('wraps rather than returning undefined for an out-of-range tone', () => {
    expect(getToneColor(getLanguageTheme('zh'), 9)).toMatch(HEX);
  });

  it('falls back to plain text colour for a language with no tones', () => {
    const theme = getLanguageTheme('ja');
    expect(getToneColor(theme, 1)).toBe(theme.colors.text);
  });

  it('keeps every tone colour legible on its own theme background', () => {
    for (const code of ['zh', 'vi'] as const) {
      const theme = getLanguageTheme(code);
      for (const [index, color] of getToneColors(theme).entries()) {
        // Tone-coloured text is set large, so the large-text threshold applies.
        expect(contrast(color, theme.colors.background), `${code} tone ${index + 1}`).toBeGreaterThan(3);
      }
    }
  });

  it('rejects an unknown language rather than returning a broken theme', () => {
    // @ts-expect-error deliberately invalid, mirroring bad imported data
    expect(() => getLanguageTheme('es')).toThrow(/No theme for language/);
  });
});

describe('the same room after dark', () => {
  it('gives every language a night palette', () => {
    for (const theme of Object.values(LANGUAGE_THEMES)) {
      expect(theme.dark, theme.languageCode).toBeDefined();
      expect(theme.dark.background).not.toBe(theme.colors.background);
      expect(theme.dark.text).not.toBe(theme.colors.text);
    }
  });

  it('keeps each language a different colour after dark', () => {
    // The whole identity is four inks. A night palette that collapses them
    // into one accent would be a different product with the lights off.
    const accents = Object.values(LANGUAGE_THEMES).map((theme) => theme.dark.accent);
    expect(new Set(accents).size).toBe(accents.length);
  });

  it('lifts the accent off the dark ground rather than reusing the paper one', () => {
    for (const theme of Object.values(LANGUAGE_THEMES)) {
      expect(theme.dark.accent, theme.languageCode).not.toBe(theme.colors.accent);
      // Brighter, not merely different: an ink for paper is too dark to read
      // on slate, which is the entire reason these exist.
      expect(luminance(theme.dark.accent), theme.languageCode).toBeGreaterThan(
        luminance(theme.colors.accent),
      );
    }
  });

  it('keeps the grade scale identical in both, because it is muscle memory', () => {
    for (const theme of Object.values(LANGUAGE_THEMES)) {
      expect(theme.dark.again).toBe(theme.colors.again);
      expect(theme.dark.good).toBe(theme.colors.good);
      expect(theme.dark.easy).toBe(theme.colors.easy);
    }
  });
});

describe('the night palettes are as readable as the day ones', () => {
  it('keeps body text above 4.5:1 on both dark surfaces', () => {
    for (const theme of Object.values(LANGUAGE_THEMES)) {
      expect(contrast(theme.dark.text, theme.dark.background), theme.languageCode).toBeGreaterThan(4.5);
      expect(contrast(theme.dark.text, theme.dark.surface), theme.languageCode).toBeGreaterThan(4.5);
    }
  });

  it('keeps muted text legible rather than merely present', () => {
    for (const theme of Object.values(LANGUAGE_THEMES)) {
      expect(contrast(theme.dark.textMuted, theme.dark.background), theme.languageCode).toBeGreaterThan(3);
    }
  });

  it('keeps each accent readable on its own night ground', () => {
    // This is the check the hand-picked values exist for: an ink chosen for
    // paper fails it, which is why there is a second one per language.
    for (const theme of Object.values(LANGUAGE_THEMES)) {
      expect(contrast(theme.dark.accent, theme.dark.background), theme.languageCode).toBeGreaterThan(4.5);
    }
  });

  it('would have failed with the paper inks, which is the point', () => {
    const failures = Object.values(LANGUAGE_THEMES).filter(
      (theme) => contrast(theme.colors.accent, theme.dark.background) < 4.5,
    );
    expect(failures.length).toBeGreaterThan(0);
  });
});

/**
 * The product's colour, which no language changes.
 *
 * The wordmark is text, so it needs text contrast on both grounds — not the
 * 3:1 a graphic can get away with. These two values are chosen against their
 * own ground rather than one being lightened from the other, and this is what
 * stops somebody "simplifying" them to one.
 */
describe('the brand orange', () => {
  it('is readable as text on paper and on slate', () => {
    expect(contrast(BRAND.orange, '#FBFAF8')).toBeGreaterThan(4.5);
    expect(contrast(BRAND.orangeDark, '#141311')).toBeGreaterThan(4.5);
  });

  it('is not mistakable for any language ink', () => {
    // The nearest is Cinnabar, and the two sit next to each other in the bar
    // whenever Mandarin is the active language.
    for (const theme of Object.values(LANGUAGE_THEMES)) {
      expect(theme.colors.accent).not.toBe(BRAND.orange);
      expect(theme.dark.accent).not.toBe(BRAND.orangeDark);
    }
  });
});
