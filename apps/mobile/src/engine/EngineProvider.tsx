import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { SEED_ENTRIES, StudyEngine, type LanguageCode, type Rating, type ReviewSource } from '@language-srs/core';
import { useAuth } from '../auth/AuthProvider';
import { widgetBridge } from '../../modules/widget-bridge';

interface EngineContextValue {
  engine: StudyEngine;
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
  // Whose data this is. Changing accounts changes the store, which rebuilds the
  // engine below — the one place the two concerns meet.
  const { store } = useAuth();

  const [engine, setEngine] = useState<StudyEngine | undefined>();
  const [error, setError] = useState<Error | undefined>();
  const [revision, setRevision] = useState(0);
  const bump = useCallback(() => setRevision((value) => value + 1), []);

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

    // Clearing first so a switch between accounts cannot show the previous
    // account's queue while the next one loads.
    engineRef.current = undefined;
    setEngine(undefined);

    (async () => {
      try {
        const instance = await StudyEngine.create({
          store,
          seedEntries: SEED_ENTRIES,
          onStateChanged: async (self) => {
            bump();
            await publishToWidget(self);
          },
        });

        if (cancelled) return;

        await drainWidgetGrades(instance);
        engineRef.current = instance;
        setEngine(instance);
        await publishToWidget(instance);
      } catch (cause) {
        if (!cancelled) setError(cause as Error);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [bump, publishToWidget, store]);

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

  const value = useMemo<EngineContextValue | undefined>(() => {
    if (!engine) return undefined;

    return {
      engine,
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
  }, [engine, revision, bump]);

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
