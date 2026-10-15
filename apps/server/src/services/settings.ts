import {
  DEFAULT_LANGUAGE_SETTINGS,
  DEFAULT_USER_SETTINGS,
  LANGUAGE_CODES,
  getExamTracksForLanguage,
  normaliseLanguageSettings,
  normaliseUserSettings,
  type LanguageCode,
  type LanguageSettings,
  type LanguageSettingsPatch,
  type UserSettings,
} from '@language-srs/core';
import { ApiError } from '../http/errors.ts';
import type { ServerStore } from '../store/types.ts';

/**
 * Settings the server can actually read.
 *
 * The state blob is deliberately opaque here — it is the engine's storage keys
 * and interpreting it would couple the server to the client's internals. These
 * are the opposite, and the difference is the point of splitting them: a
 * preference the server can read is one it can answer for, show on another
 * device before that device has synced, and later act on. A preference inside
 * the blob is a string inside a string.
 *
 * Two resources, split by what they are about rather than by where they are
 * edited. Appearance and when the day rolls over belong to the person; the
 * exam, the level and the daily limits belong to one language. The test is
 * whether the answer would still be true if you studied something else.
 */
export class SettingsService {
  constructor(private readonly store: ServerStore) {}

  /** Never 404s: an account that has set nothing has the defaults. */
  async getUser(userId: string): Promise<UserSettings> {
    const stored = await this.store.getUserSettings(userId);
    if (stored) return stored;
    return { ...DEFAULT_USER_SETTINGS, updatedAt: new Date(0).toISOString() };
  }

  async putUser(
    userId: string,
    patch: Partial<UserSettings>,
    now = new Date(),
  ): Promise<UserSettings> {
    const current = await this.getUser(userId);
    const next: UserSettings = {
      ...normaliseUserSettings(patch, current),
      updatedAt: now.toISOString(),
    };
    await this.store.putUserSettings(userId, next);
    return next;
  }

  async listLanguages(userId: string): Promise<LanguageSettings[]> {
    const stored = await this.store.listLanguageSettings(userId);
    // Sorted so two devices listing the same account see the same order; an
    // unordered list is the sort of thing that makes a diff look like a change.
    return stored.sort((left, right) => left.languageCode.localeCompare(right.languageCode));
  }

  /** The stored settings for a language, or what it would start at. */
  async getLanguage(userId: string, code: string): Promise<LanguageSettings> {
    const languageCode = this.parseCode(code);
    const stored = await this.store.getLanguageSettings(userId, languageCode);
    return stored ?? this.defaultsFor(languageCode);
  }

  async putLanguage(
    userId: string,
    code: string,
    patch: LanguageSettingsPatch,
    now = new Date(),
  ): Promise<LanguageSettings> {
    const languageCode = this.parseCode(code);
    const current = await this.getLanguage(userId, languageCode);
    const next: LanguageSettings = {
      ...normaliseLanguageSettings(patch, current),
      updatedAt: now.toISOString(),
    };
    await this.store.putLanguageSettings(userId, next);
    return next;
  }

  /**
   * A language the app does not teach is a 404, not a 400.
   *
   * The code is part of the path, so an unknown one means the resource is not
   * there rather than that the request was malformed — and when this app
   * teaches twenty languages, a client asking for one this deployment has not
   * shipped yet is exactly that.
   */
  private parseCode(code: string): LanguageCode {
    const found = LANGUAGE_CODES.find((candidate) => candidate === code);
    if (!found) throw new ApiError(404, 'not_found', `No language called ${code}.`);
    return found;
  }

  /**
   * Where a language starts.
   *
   * The track and the level come from the language itself rather than from a
   * constant: the first track the app lists for it, and that track's first
   * level. Hard-coding HSK here would be a Mandarin assumption sitting in code
   * that is about to serve twenty languages.
   */
  private defaultsFor(languageCode: LanguageCode): LanguageSettings {
    const track = getExamTracksForLanguage(languageCode)[0];
    if (!track) {
      throw new ApiError(500, 'server_error', `No exam track for ${languageCode}.`);
    }

    const level = [...track.levels].sort((left, right) => left.order - right.order)[0];
    if (!level) {
      throw new ApiError(500, 'server_error', `No levels in ${track.id}.`);
    }

    return {
      ...DEFAULT_LANGUAGE_SETTINGS,
      languageCode,
      examTrackId: track.id,
      targetLevelId: level.id,
      updatedAt: new Date(0).toISOString(),
    };
  }
}
