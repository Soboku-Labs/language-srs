import { describe, expect, it } from 'vitest';
import { LANGUAGE_CODES } from '../types/language';
import { CULTURE_PROFILES, describePlace, getCulture } from './index';

describe('culture profiles', () => {
  it('names a place for every language', () => {
    for (const code of LANGUAGE_CODES) {
      const culture = getCulture(code);
      expect(culture.languageCode).toBe(code);
      expect(culture.city.length).toBeGreaterThan(0);
      expect(culture.country.length).toBeGreaterThan(0);
    }
  });

  /**
   * The local spelling is the point of having both. A row that says "Hanoi"
   * twice has learned nothing from being asked for the endonym.
   */
  it('gives each place its own spelling as well as the English one', () => {
    for (const code of LANGUAGE_CODES) {
      const culture = getCulture(code);
      expect(culture.cityLocal.length).toBeGreaterThan(0);
      expect(culture.countryLocal.length).toBeGreaterThan(0);
    }
    expect(getCulture('vi').cityLocal).toBe('Hà Nội');
    expect(getCulture('ko').cityLocal).toBe('서울');
  });

  it('gives each language a distinct place and motif', () => {
    const cultures = Object.values(CULTURE_PROFILES);
    expect(new Set(cultures.map((culture) => culture.city)).size).toBe(cultures.length);
    expect(new Set(cultures.map((culture) => culture.motif)).size).toBe(cultures.length);
  });

  /**
   * These lines sit on a screen somebody opens every morning for months. One
   * sentence, no exclamation marks — a line that performs enthusiasm is one you
   * stop reading by the second week.
   */
  it('keeps the line short and unexcitable', () => {
    for (const culture of Object.values(CULTURE_PROFILES)) {
      expect(culture.line.length, culture.city).toBeGreaterThan(30);
      expect(culture.line.length, culture.city).toBeLessThan(140);
      expect(culture.line, culture.city).not.toContain('!');
    }
  });

  it('formats a place with its own name first', () => {
    expect(describePlace('vi')).toBe('Hà Nội · Việt Nam');
    expect(describePlace('zh')).toBe('北京 · 中国');
  });

  it('rejects an unknown language rather than returning a blank place', () => {
    // @ts-expect-error deliberately invalid, mirroring bad stored state
    expect(() => getCulture('es')).toThrow(/No culture profile/);
  });
});
