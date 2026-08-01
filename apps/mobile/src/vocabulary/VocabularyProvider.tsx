import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { LANGUAGE_CODES, getLevelIdsInScope, type LanguageCode, type VocabularyManifest } from '@language-srs/core';
import { useEngine } from '../engine/EngineProvider';
import { appStore } from '../storage/adapter';
import { VocabularyRepository } from './repository';

/**
 * Downloading the syllabus, and saying so.
 *
 * The words come from the API now, which means there is a moment — once, on a
 * device that has never seen this level — where the app knows the shape of what
 * it is about to show and not yet the content. That moment is what the skeletons
 * are for. It is not a spinner over the whole screen: the layout is already
 * known, so it is drawn, greyed, and filled in when the words land.
 *
 * The engine is never blocked on any of this. It starts on the bundled starter
 * deck and is handed the real levels when they arrive, so a first launch with no
 * network is a smaller app rather than a broken one.
 */
interface VocabularyContextValue {
  /** The manifest, once known: level sizes and sources, for the settings screen. */
  manifest?: VocabularyManifest;
  /** Languages whose levels are being fetched right now. */
  loading: Set<LanguageCode>;
  /** Languages the server could not supply and that have nothing cached. */
  unavailable: Set<LanguageCode>;
  /** How many words are on the device for a language, cached or downloaded. */
  wordCount(code: LanguageCode): number | undefined;
  /** Pull a language's levels down now — used when one is chosen. */
  prefetch(code: LanguageCode, levelId: string): void;
}

const VocabularyContext = createContext<VocabularyContextValue | undefined>(undefined);

export function VocabularyProvider({ children }: { children: React.ReactNode }) {
  const { engine, revision, mutate } = useEngine();

  const repository = useMemo(() => new VocabularyRepository(appStore), []);
  const [manifest, setManifest] = useState<VocabularyManifest | undefined>();
  const [loading, setLoading] = useState<Set<LanguageCode>>(new Set());
  const [unavailable, setUnavailable] = useState<Set<LanguageCode>>(new Set());

  /** Levels already handed to the engine, so a re-render does not redo the work. */
  const supplied = useRef<string>('');

  const mark = useCallback((code: LanguageCode, state: 'loading' | 'done' | 'failed') => {
    setLoading((current) => {
      const next = new Set(current);
      if (state === 'loading') next.add(code);
      else next.delete(code);
      return next;
    });
    if (state === 'failed') setUnavailable((current) => new Set(current).add(code));
    else if (state === 'done') {
      setUnavailable((current) => {
        if (!current.has(code)) return current;
        const next = new Set(current);
        next.delete(code);
        return next;
      });
    }
  }, []);

  /**
   * Fetch the levels one language needs and hand them to the engine.
   *
   * Scope, not everything: a learner on HSK 2 needs two levels, not nine. That
   * is the whole reason this is worth doing — the bundle carried all fourteen
   * thousand words to serve the two hundred anybody is working on.
   */
  const load = useCallback(
    async (code: LanguageCode) => {
      if (!engine.hasProfile(code)) return;

      const levelIds = getLevelIdsInScope(engine.getProfile(code).targetLevelId);
      const key = `${code}:${levelIds.join(',')}`;
      if (supplied.current === key) return;

      mark(code, 'loading');
      const cached = await repository.cached(levelIds);
      // Show what is already here before waiting on the network.
      if (cached.length > 0) await mutate((instance) => instance.setVocabulary(cached));

      const entries = await repository.ensure(levelIds);
      supplied.current = key;

      if (entries.length > 0) {
        await mutate((instance) => instance.setVocabulary(entries));
        mark(code, 'done');
      } else {
        // Nothing cached and nothing fetched: the starter deck stands, and the
        // learner is told rather than left wondering why HSK 1 has thirty words.
        mark(code, cached.length > 0 ? 'done' : 'failed');
      }
    },
    [engine, mark, mutate, repository],
  );

  // The manifest first: it is small, it tells the landing page how many words
  // each language has, and every level fetch needs its version anyway.
  useEffect(() => {
    let cancelled = false;
    void repository.getManifest().then((value) => {
      if (!cancelled) setManifest(value);
    });
    return () => {
      cancelled = true;
    };
  }, [repository]);

  // The active language's levels, whenever it or its target level changes.
  useEffect(() => {
    void load(engine.activeLanguage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine.activeLanguage, revision === 0, load]);

  const value = useMemo<VocabularyContextValue>(
    () => ({
      ...(manifest ? { manifest } : {}),
      loading,
      unavailable,
      wordCount(code) {
        return manifest?.languages[code]?.total;
      },
      prefetch(code, levelId) {
        void repository.ensure(getLevelIdsInScope(levelId));
        void code;
      },
    }),
    [manifest, loading, unavailable, repository],
  );

  return <VocabularyContext.Provider value={value}>{children}</VocabularyContext.Provider>;
}

export function useVocabulary(): VocabularyContextValue {
  const context = useContext(VocabularyContext);
  if (!context) throw new Error('useVocabulary must be used inside a VocabularyProvider');
  return context;
}

/** Every language, for the landing page's per-row state. */
export const ALL_LANGUAGES: LanguageCode[] = LANGUAGE_CODES;
