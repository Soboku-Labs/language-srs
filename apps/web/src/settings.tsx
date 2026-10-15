import {
  SETTINGS_LIMITS,
  normaliseLanguageSettings,
  type Appearance,
  type Backdrop,
  type LanguageCode,
  type LanguageSettings,
  type LanguageSettingsPatch,
  type StudyProfile,
} from '@language-srs/core';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { api, hasBackend } from './api';
import { useAuth, useEngine } from './providers';

/**
 * The one place the app reads and writes settings.
 *
 * Before this, settings were the engine's and the engine's alone: stored in its
 * meta and carried between devices inside the opaque state blob. The server can
 * now hold them as two readable resources, which is what lets a second device
 * show the right theme before it has synced anything. The question this file
 * answers is which of the two is in charge.
 *
 * ## The engine stays the local source of truth
 *
 * Not the server. Every value here is read during render and some are read by
 * the scheduler on every card — `dayStartHour` decides which day a review
 * counts towards, `desiredRetention` decides the next interval. Making those a
 * network read would be absurd, and caching them in React state would mean the
 * scheduler and the screen could disagree. So a change is written to the engine
 * first, synchronously as far as the UI is concerned, and the server is told
 * after.
 *
 * ## The server is the record across devices
 *
 * Which leaves the one genuinely hard moment: signing in, when both sides have
 * an opinion. The rule is a single question — *has the server ever been told?*
 *
 * - **It has not** (its `updatedAt` is the epoch, which is what the settings
 *   service returns for an account that has set nothing) — then the local
 *   values are the only real ones, and they are pushed up. This is what stops
 *   registering an account from wiping the theme somebody chose while trying
 *   the app out, the same way `adoptDeck` stops it wiping their deck.
 * - **It has** — then the server's values win and are written into the engine.
 *   A device that has been signed out for a week should not drag a stale
 *   preference back over one set deliberately somewhere else.
 *
 * Last write wins, in other words, and deliberately: a revision check with a
 * reconciliation step is the right machinery for a deck of cards, where losing
 * an evening's reviews is unacceptable. It is the wrong machinery for a dark
 * mode toggle. The worst case here is that a preference set offline on a device
 * you are not using loses to one set on the device you are, which is the answer
 * most people would pick anyway.
 *
 * Study is never blocked on any of this. Every push is fire-and-forget; a
 * failure leaves the local value in place and is reported, not retried into a
 * spinner.
 */

interface SettingsValue {
  appearance: Appearance;
  backdrop: Backdrop;
  /** The hour the study day rolls over, for every language. */
  dayStartHour: number;
  /** Settings for the language currently being studied. */
  language: StudyProfile;
  setAppearance(value: Appearance): Promise<void>;
  setBackdrop(value: Backdrop): Promise<void>;
  setDayStartHour(value: number): Promise<void>;
  /** Change one language's study settings. Defaults to the active language. */
  updateLanguage(patch: LanguageSettingsPatch, code?: LanguageCode): Promise<void>;
  /**
   * Switch exam track, keeping the equivalent position in the new one.
   *
   * Its own method rather than part of `updateLanguage` because the engine
   * works out the matching level, so the value to send to the server is not
   * known until after the local change has happened.
   */
  setExamTrack(trackId: string, code?: LanguageCode): Promise<void>;
  /** Set when the last push to the server failed, for the UI to mention. */
  error?: string;
}

const SettingsContext = createContext<SettingsValue | undefined>(undefined);

/** Whether the server has ever been told about this account's settings. */
function unset(updatedAt: string): boolean {
  return Date.parse(updatedAt) === 0;
}

/** A profile as the server wants it. */
function toLanguageSettings(profile: StudyProfile): LanguageSettingsPatch {
  return {
    examTrackId: profile.examTrackId,
    targetLevelId: profile.targetLevelId,
    // Null rather than omitted, so "no exam booked" is stated rather than left
    // for the server to keep whatever it had.
    examDate: profile.examDate ?? null,
    dailyNewLimit: profile.dailyNewLimit,
    dailyReviewLimit: profile.dailyReviewLimit,
    desiredRetention: profile.desiredRetention,
    ...(profile.enabledCardKinds ? { enabledCardKinds: profile.enabledCardKinds } : {}),
  };
}

/** The server's answer as a patch the engine's profile can take. */
function toProfilePatch(settings: LanguageSettings): Partial<Omit<StudyProfile, 'languageCode'>> {
  return {
    examTrackId: settings.examTrackId,
    targetLevelId: settings.targetLevelId,
    // `undefined` clears it on the engine, which is how an exam cancelled on
    // another device stops being an exam here.
    examDate: settings.examDate,
    dailyNewLimit: settings.dailyNewLimit,
    dailyReviewLimit: settings.dailyReviewLimit,
    desiredRetention: settings.desiredRetention,
    ...(settings.enabledCardKinds ? { enabledCardKinds: settings.enabledCardKinds } : {}),
  };
}

export function SettingsProvider({ children }: { children: ReactNode }) {
  const { token } = useAuth();
  const { engine, revision, mutate } = useEngine();
  const [error, setError] = useState<string | undefined>();

  /*
   * Read straight off the engine rather than copied into state.
   *
   * A second copy would be a second thing to keep in step, and the engine
   * already tells the tree to read again by bumping `revision`.
   */
  const appearance = useMemo(() => engine.appearance, [engine, revision]);
  const backdrop = useMemo(() => engine.backdrop, [engine, revision]);
  const dayStartHour = useMemo(() => engine.dayStartHour, [engine, revision]);
  const activeLanguage = useMemo(() => engine.activeLanguage, [engine, revision]);
  const language = useMemo(
    () => engine.getProfile(activeLanguage),
    [engine, revision, activeLanguage],
  );

  /**
   * Tell the server, if there is one and we are signed in.
   *
   * The token is handed to the callback rather than closed over, so there is no
   * call site asserting it is there. A device-only account and a build with no
   * backend at all both land here and do nothing, which is the whole of their
   * sync behaviour.
   */
  const push = useCallback(
    async (send: (bearer: string) => Promise<unknown>) => {
      if (!token || !hasBackend) return;
      try {
        await send(token);
        setError(undefined);
      } catch (cause) {
        // The local value is already applied, so this is worth saying and not
        // worth undoing. Rolling back a toggle somebody just pressed because
        // the network blinked is worse than the setting being a moment behind.
        setError((cause as Error).message);
      }
    },
    [token],
  );

  /*
   * Settle who is in charge, once per sign-in.
   *
   * Guarded by the token so it runs again for a different account, and
   * cancelled on unmount so a slow response cannot write one account's
   * settings into another's engine — the same hazard as the sync layer's
   * store check, and for the same reason.
   */
  const reconciled = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!token || reconciled.current === token) return;
    let cancelled = false;
    reconciled.current = token;

    void (async () => {
      try {
        const [user, remote] = await Promise.all([
          api().getUserSettings(token),
          api().getLanguageSettings(token, activeLanguage),
        ]);
        if (cancelled) return;

        if (unset(user.updatedAt)) {
          await push((bearer) =>
            api().putUserSettings(bearer, { appearance, backdrop, dayStartHour }),
          );
        } else {
          await mutate(async (instance) => {
            await instance.setAppearance(user.appearance);
            await instance.setBackdrop(user.backdrop);
            await instance.setDayStartHour(user.dayStartHour);
          });
        }

        if (cancelled) return;

        if (unset(remote.updatedAt)) {
          await push((bearer) =>
            api().putLanguageSettings(bearer, activeLanguage, toLanguageSettings(language)),
          );
        } else {
          await mutate((instance) =>
            instance.updateProfile(activeLanguage, toProfilePatch(remote)),
          );
        }
      } catch (cause) {
        if (!cancelled) setError((cause as Error).message);
      }
    })();

    return () => {
      cancelled = true;
    };
    // Deliberately keyed on the token alone. This is a sign-in-time
    // reconciliation, not a subscription: re-running it whenever a setting
    // changed would mean every toggle fought the value it had just written.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const value = useMemo<SettingsValue>(
    () => ({
      appearance,
      backdrop,
      dayStartHour,
      language,
      ...(error ? { error } : {}),

      setAppearance: async (next) => {
        await mutate((instance) => instance.setAppearance(next));
        await push((bearer) => api().putUserSettings(bearer, { appearance: next }));
      },

      setBackdrop: async (next) => {
        await mutate((instance) => instance.setBackdrop(next));
        await push((bearer) => api().putUserSettings(bearer, { backdrop: next }));
      },

      setDayStartHour: async (next) => {
        const hour = Math.round(
          Math.min(
            SETTINGS_LIMITS.dayStartHour.max,
            Math.max(SETTINGS_LIMITS.dayStartHour.min, next),
          ),
        );
        await mutate((instance) => instance.setDayStartHour(hour));
        await push((bearer) => api().putUserSettings(bearer, { dayStartHour: hour }));
      },

      updateLanguage: async (patch, code = activeLanguage) => {
        /*
         * Normalised locally against the same rules the server enforces.
         *
         * Not for safety — the server normalises whatever it is sent — but so
         * the number on screen is the number that was stored. Without it a
         * stepper pushed past its limit would show 600 until the next reload
         * and then quietly become 500.
         */
        const current = engine.getProfile(code);
        const next = normaliseLanguageSettings(patch, {
          ...current,
          languageCode: code,
          updatedAt: current.updatedAt,
        });

        await mutate((instance) =>
          instance.updateProfile(code, {
            ...next,
            // `normaliseLanguageSettings` drops the key entirely to clear it;
            // the engine needs it present and undefined to do the same.
            examDate: next.examDate,
          }),
        );
        await push((bearer) => api().putLanguageSettings(bearer, code, patch));
      },

      setExamTrack: async (trackId, code = activeLanguage) => {
        // The engine picks the level in the new track that matches the current
        // position, so the whole profile is sent afterwards rather than a patch
        // guessed at beforehand.
        const next = await mutate((instance) => instance.setExamTrack(code, trackId));
        await push((bearer) =>
          api().putLanguageSettings(bearer, code, toLanguageSettings(next)),
        );
      },
    }),
    [appearance, backdrop, dayStartHour, language, error, activeLanguage, engine, mutate, push, token],
  );

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): SettingsValue {
  const context = useContext(SettingsContext);
  if (!context) throw new Error('useSettings must be used inside a SettingsProvider');
  return context;
}
