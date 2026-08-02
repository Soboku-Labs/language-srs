import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import {
  PrefixedStore,
  StudyEngine,
  accountPrefix,
  type LanguageCode,
  type Rating,
  type ReviewSource,
} from '@language-srs/core';
import { useAuth } from '../auth/AuthProvider';
import { appStore } from '../storage/adapter';
import { widgetBridge } from '../../modules/widget-bridge';

interface EngineContextValue {
  engine: StudyEngine;
  /**
   * The account this engine was built for; undefined when signed out.
   *
   * Published so anything that acts on the engine's behalf can check it is
   * acting for the account it thinks it is — see the guard in `SyncProvider`.
   */
  accountId?: string;
  /**
   * Bumped on every mutation.
   *
   * The engine holds mutable state rather than immutable snapshots, so React
   * cannot diff it. Screens read what they need from the engine during render and
   * depend on this counter to know when to read again. It keeps the domain free
   * of React concerns without a redundant second copy of the state in a store.
   */
  revision: number;
  grade(cardId: string, rating: Rating, options?: { durationMs?: number; source?: ReviewSource }): Promise<void>;
  setActiveLanguage(code: LanguageCode): Promise<void>;
  mutate<T>(action: (engine: StudyEngine) => Promise<T>): Promise<T>;
}

const EngineContext = createContext<EngineContextValue | undefined>(undefined);

export function EngineProvider({ children }: { children: React.ReactNode }) {
  const { status, user } = useAuth();
  const [engine, setEngine] = useState<StudyEngine | undefined>();
  /**
   * Which account the current engine belongs to.
   *
   * Tracked separately from `engine` so a stale engine can be recognised during
   * render rather than only in an effect. React runs child effects before parent
   * ones, so between an account changing and this provider rebuilding, children
   * would otherwise get one render with the new account and the old engine —
   * long enough for the sync loop to pull one account's cards into another's
   * storage, which is exactly what it did before this existed.
   */
  const [engineFor, setEngineFor] = useState<string | undefined>(undefined);
  const [error, setError] = useState<Error | undefined>();
  const [revision, setRevision] = useState(0);
  const bump = useCallback(() => setRevision((value) => value + 1), []);

  /**
   * The storage namespace this engine works in.
   *
   * Signing in moves the whole domain to `acct:<id>:`, so two people sharing a
   * device keep separate decks and neither can see the other's schedule. The
   * signed-out namespace is the empty prefix — exactly where the app wrote
   * before accounts existed, so a learner who studied first and signed up later
   * finds their cards where they left them.
   */
  const accountId = status === 'signed-in' ? user?.id : undefined;

  // Keeps the change handler stable while still seeing the latest engine.
  const engineRef = useRef<StudyEngine | undefined>(undefined);

  /**
   * Push the current state to the home-screen widgets.
   *
   * Called after every mutation so the widget is never more than one state change
   * behind. Failures are swallowed on purpose: a widget that cannot be reached is
   * a cosmetic problem, and letting it reject would surface as a failed review.
   */
  const publishToWidget = useCallback(async (instance: StudyEngine) => {
    if (!widgetBridge.isSupported) return;
    try {
      await widgetBridge.publishSnapshot(instance.getWidgetSnapshot());
    } catch {
      // Intentionally ignored — see above.
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    // Wait for the stored session to be read before touching storage: building
    // an engine on the signed-out namespace and swapping it a moment later would
    // show the wrong learner's counts for that moment.
    if (status === 'loading') return;

    setEngine(undefined);

    (async () => {
      try {
        const instance = await StudyEngine.create({
          // No `seedEntries`: the engine defaults to the bundled syllabuses —
          // the real HSK, JLPT, TOPIK and frequency lists — rather than the
          // thirty hand-written words the app started with.
          store: new PrefixedStore(appStore, accountPrefix(accountId)),
          onStateChanged: async (self) => {
            bump();
            await publishToWidget(self);
          },
        });

        if (cancelled) return;

        await drainWidgetGrades(instance);
        engineRef.current = instance;
        setEngine(instance);
        setEngineFor(accountId);
        await publishToWidget(instance);
      } catch (cause) {
        if (!cancelled) setError(cause as Error);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [bump, publishToWidget, accountId, status]);

  /**
   * Pick up home-screen gradings whenever the app comes back to the foreground.
   *
   * Launch is not enough. The common case is tapping a grade button on the widget
   * while the app is already suspended in the background, then opening it — no
   * fresh launch happens, so without this the taps would sit in the queue until
   * the app was killed and restarted.
   */
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (status: AppStateStatus) => {
      if (status !== 'active') return;
      const instance = engineRef.current;
      if (!instance) return;
      void drainWidgetGrades(instance).then(() => bump());
    });
    return () => subscription.remove();
  }, [bump]);

  // Stale means the account has changed and the engine for it is still being
  // built. Withholding the context is what keeps a screen — or the sync loop —
  // from acting on the previous account's data for one render.
  const stale = engineFor !== accountId;

  const value = useMemo<EngineContextValue | undefined>(() => {
    if (!engine || stale) return undefined;

    return {
      engine,
      ...(accountId ? { accountId } : {}),
      revision,
      async grade(cardId, rating, options) {
        await engine.grade(cardId, rating, options ?? {});
        bump();
      },
      async setActiveLanguage(code) {
        await engine.setActiveLanguage(code);
        bump();
      },
      async mutate(action) {
        const result = await action(engine);
        bump();
        return result;
      },
    };
  }, [engine, revision, bump, accountId, stale]);

  if (error) throw error;
  if (!value) return null;

  return <EngineContext.Provider value={value}>{children}</EngineContext.Provider>;
}

/** Read the queued widget gradings, hand them to the engine, and clear them. */
async function drainWidgetGrades(engine: StudyEngine): Promise<void> {
  if (!widgetBridge.isSupported) return;

  try {
    const pending = await widgetBridge.readPendingGrades();
    if (pending.length === 0) return;

    for (const grade of pending) {
      await engine.enqueueWidgetGrade(grade);
    }
    // Clear only after the engine has durably queued them, so a crash in between
    // loses nothing — the engine's own queue is persisted before this point.
    await widgetBridge.clearPendingGrades();
    await engine.applyPendingWidgetGrades();
  } catch {
    // Leave the queue in place and try again on the next foreground.
  }
}

export function useEngine(): EngineContextValue {
  const context = useContext(EngineContext);
  if (!context) throw new Error('useEngine must be used inside an EngineProvider');
  return context;
}
