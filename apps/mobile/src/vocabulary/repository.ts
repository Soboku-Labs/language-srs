import {
  SEED_ENTRIES,
  expandEntries,
  readJson,
  writeJson,
  type CompactEntry,
  type KeyValueStore,
  type LanguageCode,
  type LexicalEntry,
  type VocabularyManifest,
} from '@language-srs/core';
import { ApiRequestError, createApiClient, type ApiClient } from '../auth/client';

/**
 * Getting the syllabus onto the device.
 *
 * The word lists used to be compiled into the bundle: 1.7MB shipped on install
 * and again on every update, so somebody could study fifteen words a day. They
 * are downloaded now, a level at a time, and kept.
 *
 * Three rules make that bearable on a phone in a tunnel:
 *
 * 1. **Cached forever, keyed by version.** A level's words change when a scraper
 *    runs and a commit lands. The cache key carries the dataset version, so a
 *    device holds HSK 1 until the words themselves change and never asks again.
 * 2. **Shared between accounts.** Public reference data goes in the device-wide
 *    store, not the account's namespace: two people sharing a phone should not
 *    download HSK 1 twice, and signing out should not throw it away.
 * 3. **Never blocking.** The starter deck is bundled and always available, so a
 *    first launch with no server has something to study while the real syllabus
 *    is still arriving — or forever, if it never does.
 */

const MANIFEST_KEY = 'vocab:v1:manifest';
const levelKey = (levelId: string, version: string) => `vocab:v1:${version}:${levelId}`;

/** What a caller can see about a level while it is being fetched. */
export type LevelStatus = 'cached' | 'loading' | 'ready' | 'unavailable';

export interface VocabularyProgress {
  /** Levels still in flight. */
  loading: string[];
  /** Levels that could not be fetched and are not cached. */
  unavailable: string[];
}

export class VocabularyRepository {
  /** In-memory, so a re-render does not re-read the store. */
  private readonly memory = new Map<string, LexicalEntry[]>();
  private readonly inFlight = new Map<string, Promise<LexicalEntry[] | undefined>>();
  private manifest?: VocabularyManifest;

  constructor(
    private readonly store: KeyValueStore,
    private readonly api: ApiClient = createApiClient(),
  ) {}

  /** The starter deck, for a device that has never reached the server. */
  static get fallback(): LexicalEntry[] {
    return SEED_ENTRIES;
  }

  /**
   * The manifest, from cache first.
   *
   * Held for the session and persisted, so the counts on the settings screen do
   * not depend on a network round trip — and so a device that has been offline
   * for a week still knows how big HSK 3 is.
   */
  async getManifest(): Promise<VocabularyManifest | undefined> {
    if (this.manifest) return this.manifest;

    const cached = await readJson<VocabularyManifest | null>(this.store, MANIFEST_KEY, null);
    if (cached) this.manifest = cached;

    try {
      const fresh = await this.api.getVocabularyManifest();
      this.manifest = fresh;
      await writeJson(this.store, MANIFEST_KEY, fresh);
    } catch {
      // Offline, or no vocabulary on this server. The cached copy stands; if
      // there is none, callers fall back to the starter deck.
    }

    return this.manifest;
  }

  /** Whatever is already on the device for these levels, without a network call. */
  async cached(levelIds: string[]): Promise<LexicalEntry[]> {
    const version = this.manifest?.version;
    if (!version) return [];

    const found: LexicalEntry[] = [];
    for (const levelId of levelIds) {
      const entries = this.memory.get(levelId) ?? (await this.readCache(levelId, version));
      if (entries) found.push(...entries);
    }
    return found;
  }

  /**
   * Make sure these levels are on the device, fetching what is missing.
   *
   * `onProgress` fires as each level lands, which is what lets the screen show a
   * skeleton per language rather than one spinner for the lot: a learner opening
   * Mandarin should not wait on Korean.
   */
  async ensure(
    levelIds: string[],
    onProgress?: (progress: VocabularyProgress) => void,
  ): Promise<LexicalEntry[]> {
    const manifest = await this.getManifest();
    const version = manifest?.version;
    if (!version) return [];

    const loading = new Set<string>();
    const unavailable = new Set<string>();
    const report = () => onProgress?.({ loading: [...loading], unavailable: [...unavailable] });

    const results = await Promise.all(
      levelIds.map(async (levelId) => {
        const held = this.memory.get(levelId) ?? (await this.readCache(levelId, version));
        if (held) return held;

        loading.add(levelId);
        report();

        const fetched = await this.fetch(levelId, version);

        loading.delete(levelId);
        if (!fetched) unavailable.add(levelId);
        report();

        return fetched;
      }),
    );

    return results.flatMap((entries) => entries ?? []);
  }

  /**
   * Fetch one level, once.
   *
   * Requests are de-duplicated by level: two screens asking for HSK 1 at the
   * same moment is one download, not two.
   */
  private fetch(levelId: string, version: string): Promise<LexicalEntry[] | undefined> {
    const existing = this.inFlight.get(levelId);
    if (existing) return existing;

    const request = (async () => {
      try {
        const level = await this.api.getVocabularyLevel(levelId);
        const entries = expandEntries(level.entries, level.languageCode, levelId);

        this.memory.set(levelId, entries);
        await this.writeCache(levelId, level.version, level.entries);
        return entries;
      } catch (error) {
        // A level the server does not have is not an error worth surfacing: the
        // learner keeps the starter deck and the app keeps working.
        if (!(error instanceof ApiRequestError)) throw error;
        return undefined;
      } finally {
        this.inFlight.delete(levelId);
      }
    })();

    this.inFlight.set(levelId, request);
    return request;
  }

  private async readCache(levelId: string, version: string): Promise<LexicalEntry[] | undefined> {
    const raw = await readJson<{ code: LanguageCode; entries: CompactEntry[] } | null>(
      this.store,
      levelKey(levelId, version),
      null,
    );
    if (!raw) return undefined;

    const entries = expandEntries(raw.entries, raw.code, levelId);
    this.memory.set(levelId, entries);
    return entries;
  }

  private async writeCache(levelId: string, version: string, entries: CompactEntry[]): Promise<void> {
    const code = this.languageOf(levelId);
    if (!code) return;
    await writeJson(this.store, levelKey(levelId, version), { code, entries });
  }

  private languageOf(levelId: string): LanguageCode | undefined {
    for (const [code, language] of Object.entries(this.manifest?.languages ?? {})) {
      if (levelId in language.levels) return code as LanguageCode;
    }
    return undefined;
  }
}
