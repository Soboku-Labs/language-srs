import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LANGUAGE_SETTINGS,
  DEFAULT_USER_SETTINGS,
  normaliseLanguageSettings,
  normaliseUserSettings,
  type LanguageSettings,
  type UserSettings,
} from './index';
import { DEFAULT_STUDY_PROFILE } from '../types/card';

const user: UserSettings = { ...DEFAULT_USER_SETTINGS, updatedAt: '2026-01-01T00:00:00.000Z' };

const language: LanguageSettings = {
  ...DEFAULT_LANGUAGE_SETTINGS,
  languageCode: 'zh',
  examTrackId: 'hsk',
  targetLevelId: 'hsk-3',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

/**
 * These run on both sides — the app stops somebody typing 900 new cards a day,
 * and the server stops a client that does not. Testing them here rather than
 * twice is the point of them living in core.
 */
describe('normalising user settings', () => {
  it('keeps what is absent', () => {
    const next = normaliseUserSettings({ appearance: 'dark' }, user);
    expect(next).toEqual({ appearance: 'dark', backdrop: 'calm', dayStartHour: 4 });
  });

  it('falls back rather than failing on a value it does not know', () => {
    // A client one version ahead, or one version behind, must not be able to
    // make this throw — a settings write that 500s is a settings screen that
    // cannot be escaped.
    const next = normaliseUserSettings({ appearance: 'neon' as 'dark' }, user);
    expect(next.appearance).toBe('system');
  });

  it('clamps and rounds the hour the day rolls over', () => {
    expect(normaliseUserSettings({ dayStartHour: 99 }, user).dayStartHour).toBe(23);
    expect(normaliseUserSettings({ dayStartHour: -4 }, user).dayStartHour).toBe(0);
    expect(normaliseUserSettings({ dayStartHour: 6.7 }, user).dayStartHour).toBe(7);
  });

  it('ignores a number that is not one', () => {
    expect(normaliseUserSettings({ dayStartHour: Number.NaN }, user).dayStartHour).toBe(4);
  });
});

/**
 * The two default sets describe the same thing and must not drift.
 *
 * They started out disagreeing — ten new cards a day on the server, fifteen in
 * the engine — so a language began at a different pace depending on which side
 * created it first. Nothing catches that by reading the code, so it is asserted.
 */
describe('the server and engine defaults', () => {
  it('agree on where a language starts', () => {
    expect({
      dailyNewLimit: DEFAULT_LANGUAGE_SETTINGS.dailyNewLimit,
      dailyReviewLimit: DEFAULT_LANGUAGE_SETTINGS.dailyReviewLimit,
      desiredRetention: DEFAULT_LANGUAGE_SETTINGS.desiredRetention,
    }).toEqual({
      dailyNewLimit: DEFAULT_STUDY_PROFILE.dailyNewLimit,
      dailyReviewLimit: DEFAULT_STUDY_PROFILE.dailyReviewLimit,
      desiredRetention: DEFAULT_STUDY_PROFILE.desiredRetention,
    });
  });

  it('agree on when the study day starts', () => {
    expect(DEFAULT_USER_SETTINGS.dayStartHour).toBe(DEFAULT_STUDY_PROFILE.dayStartHour);
  });
});

describe('normalising language settings', () => {
  it('will not let a patch change which language it is about', () => {
    // The language comes from the path, not the body. Honouring it here would
    // let a PUT to /settings/languages/zh overwrite the Japanese row.
    const next = normaliseLanguageSettings({ languageCode: 'ja' }, language);
    expect(next.languageCode).toBe('zh');
  });

  it('clamps the daily limits', () => {
    expect(normaliseLanguageSettings({ dailyNewLimit: 9000 }, language).dailyNewLimit).toBe(500);
    expect(normaliseLanguageSettings({ dailyReviewLimit: -1 }, language).dailyReviewLimit).toBe(0);
  });

  it('clamps retention without rounding it to a whole number', () => {
    // Rounding here would turn every retention setting into 1.
    expect(normaliseLanguageSettings({ desiredRetention: 0.85 }, language).desiredRetention).toBe(
      0.85,
    );
    expect(normaliseLanguageSettings({ desiredRetention: 0.999 }, language).desiredRetention).toBe(
      0.98,
    );
  });

  it('keeps an exam date that is not mentioned', () => {
    const booked = { ...language, examDate: '2026-06-01' };
    expect(normaliseLanguageSettings({ dailyNewLimit: 20 }, booked).examDate).toBe('2026-06-01');
  });

  it('records when the learner was asked what they wanted', () => {
    const next = normaliseLanguageSettings({ setUpAt: '2026-03-01T09:00:00.000Z' }, language);
    expect(next.setUpAt).toBe('2026-03-01T09:00:00.000Z');
  });

  it('will not let a later patch clear or move it', () => {
    // Write-once, unlike the exam date: having been asked is not something
    // that stops being true. A stale client clearing it would reopen the setup
    // interview on somebody who has been studying for months.
    const asked = { ...language, setUpAt: '2026-03-01T09:00:00.000Z' };
    expect(normaliseLanguageSettings({ dailyNewLimit: 20 }, asked).setUpAt).toBe(
      '2026-03-01T09:00:00.000Z',
    );
    expect(
      normaliseLanguageSettings({ setUpAt: '2026-09-09T09:00:00.000Z' }, asked).setUpAt,
    ).toBe('2026-03-01T09:00:00.000Z');
  });

  it('stays absent until somebody is actually asked', () => {
    expect(normaliseLanguageSettings({ dailyNewLimit: 20 }, language).setUpAt).toBeUndefined();
  });

  it('clears an exam date when sent null', () => {
    // Absent means "leave it"; null means "cancelled". Without the difference
    // there is no way to un-book an exam.
    const booked = { ...language, examDate: '2026-06-01' };
    const next = normaliseLanguageSettings({ examDate: null }, booked);
    expect(next.examDate).toBeUndefined();
  });
});
