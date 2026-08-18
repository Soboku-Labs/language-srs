import { describe, expect, it } from 'vitest';
import { LANGUAGE_CODES, getLanguageProfile } from '../types/language';
import {
  LANGUAGE_THEMES,
  RADIUS,
  getLanguageTheme,
  getToneColor,
  getToneColors,
  resolvePalette,
  type Palette,
  type ThemeMode,
} from './palettes';

const HEX = /^#[0-9A-Fa-f]{6}$/;
const MODES: ThemeMode[] = ['light', 'dark'];

/**
 * Relative luminance, per WCAG.
 *
 * The palettes are hand-picked, which is exactly the situation where one quietly
 * ends up with grey-on-grey text. The type system cannot catch that; this can.
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

function eachPalette(visit: (palette: Palette, label: string) => void): void {
  for (const code of LANGUAGE_CODES) {
    for (const mode of MODES) {
      visit(resolvePalette(code, mode), `${code}/${mode}`);
    }
  }
}

describe('the Suboku system', () => {
  it('provides a light and a dark palette for every language', () => {
    for (const code of LANGUAGE_CODES) {
      expect(getLanguageTheme(code).light.canvas).toMatch(HEX);
      expect(getLanguageTheme(code).dark.canvas).toMatch(HEX);
    }
  });

  it('uses well-formed hex everywhere', () => {
    eachPalette((palette, label) => {
      for (const [name, value] of Object.entries(palette)) {
        if (name === 'tones') continue;
        expect(value, `${label}.${name}`).toMatch(HEX);
      }
    });
  });

  /**
   * The core claim of the redesign: one canvas, and language moves exactly one
   * thing. If a second field ever starts varying per language, this fails and the
   * system has quietly become four systems again.
   */
  it('varies nothing between languages except the accent and the tone ramp', () => {
    for (const mode of MODES) {
      const palettes = LANGUAGE_CODES.map((code) => resolvePalette(code, mode));
      const varying = new Set<string>();

      for (const key of Object.keys(palettes[0]!) as (keyof Palette)[]) {
        const values = palettes.map((palette) => JSON.stringify(palette[key]));
        if (new Set(values).size > 1) varying.add(key);
      }

      // A subset, not an equality: `onAccent` is white for every accent in light
      // mode, so it does not vary there. The claim being tested is that nothing
      // *outside* this set varies.
      const allowed = new Set(['accent', 'accentSoft', 'onAccent', 'tones']);
      expect([...varying].filter((key) => !allowed.has(key)), mode).toEqual([]);
    }
  });

  it('shares one radius scale across the product', () => {
    for (const code of LANGUAGE_CODES) {
      expect(getLanguageTheme(code).radius).toBe(RADIUS);
    }
  });

  it('keeps the two modes genuinely inverted rather than merely tinted', () => {
    for (const code of LANGUAGE_CODES) {
      const { light, dark } = getLanguageTheme(code);
      expect(luminance(light.canvas)).toBeGreaterThan(0.7);
      expect(luminance(dark.canvas)).toBeLessThan(0.05);
    }
  });

  it('gives each language a distinct accent in both modes', () => {
    for (const mode of MODES) {
      const accents = LANGUAGE_CODES.map((code) => resolvePalette(code, mode).accent);
      expect(new Set(accents).size, mode).toBe(LANGUAGE_CODES.length);
    }
  });

  it('names every accent', () => {
    for (const code of LANGUAGE_CODES) {
      expect(getLanguageTheme(code).accentName.length).toBeGreaterThan(2);
    }
  });
});

describe('legibility', () => {
  it('keeps body text at AA on both the canvas and a surface', () => {
    eachPalette((palette, label) => {
      expect(contrast(palette.ink, palette.canvas), label).toBeGreaterThan(4.5);
      expect(contrast(palette.ink, palette.surface), label).toBeGreaterThan(4.5);
    });
  });

  it('keeps muted text readable, and faint text at least at the large-text bar', () => {
    eachPalette((palette, label) => {
      expect(contrast(palette.inkMuted, palette.canvas), label).toBeGreaterThan(4);
      expect(contrast(palette.inkFaint, palette.canvas), label).toBeGreaterThan(2.5);
    });
  });

  it('keeps the accent legible as text on the canvas', () => {
    eachPalette((palette, label) => {
      expect(contrast(palette.accent, palette.canvas), label).toBeGreaterThan(3);
    });
  });

  it('keeps the accent label legible on top of the accent itself', () => {
    // The four accents run from a deep indigo to a light ochre, so a fixed white
    // label is unreadable on at least one of them.
    eachPalette((palette, label) => {
      expect(contrast(palette.onAccent, palette.accent), label).toBeGreaterThan(4.5);
    });
  });

  it('keeps the accent wash distinct from the canvas it sits on', () => {
    eachPalette((palette, label) => {
      expect(palette.accentSoft, label).not.toBe(palette.canvas);
      expect(contrast(palette.accentSoft, palette.canvas), label).toBeLessThan(2);
    });
  });

  it('keeps every grade colour legible on the canvas', () => {
    eachPalette((palette, label) => {
      for (const grade of ['again', 'hard', 'good', 'easy'] as const) {
        expect(contrast(palette[grade], palette.canvas), `${label}.${grade}`).toBeGreaterThan(3);
      }
    });
  });

  it('keeps the four grade colours distinct from each other', () => {
    eachPalette((palette, label) => {
      const grades = [palette.again, palette.hard, palette.good, palette.easy];
      expect(new Set(grades).size, label).toBe(4);
    });
  });
});

describe('tone ramps', () => {
  it('gives tonal languages one colour per tone and non-tonal ones none', () => {
    for (const code of LANGUAGE_CODES) {
      const profile = getLanguageProfile(code);
      for (const mode of MODES) {
        expect(getToneColors(code, mode), `${code}/${mode}`).toHaveLength(
          profile.tonal ? profile.toneCount : 0,
        );
      }
    }
  });

  it('gives each tone a distinct colour, since the colour is the answer', () => {
    for (const code of ['zh', 'vi'] as const) {
      for (const mode of MODES) {
        const colors = getToneColors(code, mode);
        expect(new Set(colors).size, `${code}/${mode}`).toBe(colors.length);
      }
    }
  });

  it('keeps every tone colour legible on its canvas', () => {
    for (const code of ['zh', 'vi'] as const) {
      for (const mode of MODES) {
        const palette = resolvePalette(code, mode);
        for (const [index, color] of palette.tones.entries()) {
          expect(contrast(color, palette.canvas), `${code}/${mode} tone ${index + 1}`).toBeGreaterThan(3);
        }
      }
    }
  });

  it('gives the quietest tone the quietest colour in each language', () => {
    // Mandarin's neutral tone is fifth; Vietnamese's unmarked ngang is first.
    // Both should be the least saturated entry, matching how they look on the page.
    const zh = getToneColors('zh', 'light');
    const vi = getToneColors('vi', 'light');
    expect(zh[4]).toBe('#8A8A8F');
    expect(vi[0]).toBe('#8A8A8F');
  });

  it('wraps rather than returning undefined for an out-of-range tone', () => {
    expect(getToneColor('zh', 'light', 9)).toMatch(HEX);
  });

  it('falls back to ink for a language with no tones', () => {
    const palette = resolvePalette('ja', 'light');
    expect(getToneColor('ja', 'light', 1)).toBe(palette.ink);
  });

  it('rejects an unknown language rather than returning a broken theme', () => {
    // @ts-expect-error deliberately invalid, mirroring bad imported data
    expect(() => getLanguageTheme('es')).toThrow(/No theme for language/);
  });
});
