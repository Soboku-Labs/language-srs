import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  LANGUAGE_CODES,
  VOCABULARY_SOURCES,
  type CompactEntry,
  type LanguageCode,
  type VocabularyFile,
  type VocabularyManifest,
} from '@language-srs/core';
import { ApiError } from '../http/errors.ts';

/**
 * The syllabuses, served rather than shipped.
 *
 * Fourteen thousand words used to be compiled into the app bundle — 1.7MB sent
 * to a phone on install and again on every update, so that somebody could study
 * fifteen words a day. They live here now: read from `data/vocab/` at startup,
 * indexed by level, and handed out a level at a time to a client that caches
 * what it is given.
 *
 * Two properties make that safe to cache aggressively:
 *
 * - **It is immutable.** A level's words change when a scraper runs and a commit
 *   lands, not while anybody is studying. Responses carry a strong ETag and a
 *   long max-age, so the second device to ask for HSK 1 this week costs a 304.
 * - **It is public.** No authentication: this is a published word list, the same
 *   for everybody, and requiring a token to read it would mean a learner cannot
 *   see the syllabus until they have an account.
 *
 * Held in memory because it is 1.7MB of read-only data that every request wants
 * and nothing ever writes — the one shape where a cache is simply correct.
 */
export class VocabularyService {
  private readonly byLanguage = new Map<LanguageCode, VocabularyFile>();
  private readonly levelLanguage = new Map<string, LanguageCode>();
  private manifestValue: VocabularyManifest = {
    version: 'empty',
    languages: {} as VocabularyManifest['languages'],
    sources: VOCABULARY_SOURCES,
  };

  private constructor() {}

  /**
   * Load the datasets.
   *
   * A missing file is survivable and says so in the log: the API's other job —
   * accounts — has nothing to do with vocabulary, and refusing to start would
   * take sign-in down over a word list. Clients fall back to the starter deck
   * they already carry.
   */
  static async load(directory: string): Promise<VocabularyService> {
    const service = new VocabularyService();
    const hash = createHash('sha256');
    const languages: VocabularyManifest['languages'] = {} as VocabularyManifest['languages'];

    for (const code of LANGUAGE_CODES) {
      const path = join(directory, `${code}.json`);

      try {
        const raw = await readFile(path, 'utf8');
        const file = JSON.parse(raw) as VocabularyFile;

        service.byLanguage.set(code, file);
        for (const levelId of Object.keys(file)) service.levelLanguage.set(levelId, code);

        // The version is a hash of the content, so a rebuilt dataset invalidates
        // every cached level on every device without anybody remembering to bump
        // a number.
        hash.update(raw);

        const levels = Object.fromEntries(
          Object.entries(file).map(([levelId, entries]) => [levelId, entries.length]),
        );
        languages[code] = {
          levels,
          total: Object.values(levels).reduce((sum, count) => sum + count, 0),
        };
      } catch (error) {
        console.warn(`[api] no vocabulary for ${code}: ${(error as Error).message}`);
        languages[code] = { levels: {}, total: 0 };
      }
    }

    service.manifestValue = {
      version: hash.digest('hex').slice(0, 16),
      languages,
      sources: VOCABULARY_SOURCES,
    };

    const total = Object.values(languages).reduce((sum, language) => sum + language.total, 0);
    console.log(`[api] vocabulary ${service.manifestValue.version}: ${total} words`);

    return service;
  }

  get manifest(): VocabularyManifest {
    return this.manifestValue;
  }

  get version(): string {
    return this.manifestValue.version;
  }

  /** One level's words, most frequent first. */
  level(levelId: string): { languageCode: LanguageCode; entries: CompactEntry[] } {
    const code = this.levelLanguage.get(levelId);
    const entries = code ? this.byLanguage.get(code)?.[levelId] : undefined;
    if (!code || !entries) throw new ApiError(404, 'not_found', `No vocabulary for level ${levelId}.`);
    return { languageCode: code, entries };
  }

  /**
   * Several levels at once.
   *
   * The app needs everything in scope — HSK 4 means four levels — and four round
   * trips on a cold start is four chances for one to be the slow one. Capped so
   * a caller cannot ask for the entire corpus in a single request.
   */
  levels(levelIds: string[]): { levelId: string; languageCode: LanguageCode; entries: CompactEntry[] }[] {
    if (levelIds.length > 12) {
      throw new ApiError(400, 'bad_request', 'Ask for at most twelve levels at a time.');
    }
    return levelIds.map((levelId) => ({ levelId, ...this.level(levelId) }));
  }
}
