import {
  LANGUAGE_CODES,
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
   * Pull one language's settings from the account before opening it.
   *
   * Awaited by the door, because what it finds decides where the door leads:
   * a language already set up elsewhere goes to the deck, and one nobody has
   * answered for goes to the setup questions. Resolves immediately when there
   * is no account, no backend, or this language has already been settled.
   */
  loadLanguage(code: LanguageCode): Promise<void>;
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
    // Write-once on the server, so sending it can only ever set it. Leaving it
    // out meant a device that had been told somebody answered the setup
    // questions kept that to itself.
    ...(profile.setUpAt ? { setUpAt: profile.setUpAt } : {}),
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
    /*
     * Only ever set, never cleared.
     *
     * `setUpAt` is the record that somebody answered the setup questions for
     * this language, and the server treats it as write-once for exactly this
     * reason. Passing `undefined` through here would let a server row written
     * before the field existed reopen the interview on somebody mid-deck.
     */
    ...(settings.setUpAt ? { setUpAt: settings.setUpAt } : {}),
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

  /**
   * Which account has been settled, and which of its languages.
   *
   * One flag was enough while reconciliation meant "the language that happened
   * to be open when you signed in". It is not enough now: every language is
   * its own resource on the server, so the question is per language, and the
   * answer has to survive opening a second one.
   */
  const reconciled = useRef<{ token?: string; user: boolean; languages: Set<LanguageCode> }>({
    user: false,
    languages: new Set(),
  });

  /**
   * Bring one language's settings into line with the server.
   *
   * Idempotent per sign-in, and exported so that *opening* a language can wait
   * for it. That matters more than it sounds: the door decides between the
   * setup interview and the deck by reading `setUpAt` off the local profile,
   * and a language first opened on this device has no local profile at all
   * until `ensureProfile` invents one. Without this, picking Korean up on a
   * laptop and then opening it on a phone asked the phone's owner to set up a
   * language they had already set up, at a level they had not chosen.
   */
  const loadLanguage = useCallback(
    async (code: LanguageCode) => {
      if (!token || !hasBackend) return;
      const state = reconciled.current;
      /*
       * A language this device has never opened is always asked about.
       *
       * The bookkeeping alone was not safe to trust here. The sign-in pass
       * marks every language it touches, including ones it only *pushed* — so
       * a language the account gained elsewhere could be marked settled by a
       * push of this device's defaults, and this pull would then be skipped
       * for the one case it exists to cover. Having no local profile is the
       * unambiguous signal that nothing here knows anything about this
       * language yet, whatever the bookkeeping says.
       */
      const unknownHere = !engine.hasProfile(code);
      if (!unknownHere && state.token === token && state.languages.has(code)) return;
      state.languages.add(code);

      try {
        const remote = await api().getLanguageSettings(token, code);
        if (unset(remote.updatedAt)) {
          // The server has never heard of this language. Whatever is here is
          // the only record of it, which is the `adoptDeck` rule applied one
          // language at a time.
          const local = engine.hasProfile(code) ? engine.getProfile(code) : undefined;
          if (local) {
            await push((bearer) => api().putLanguageSettings(bearer, code, toLanguageSettings(local)));
          }
        } else {
          await mutate((instance) => instance.updateProfile(code, toProfilePatch(remote)));
        }
      } catch (cause) {
        // Left unmarked, so opening the language again tries again. A failed
        // pull must not look like a settled one.
        state.languages.delete(code);
        setError((cause as Error).message);
      }
    },
    [token, engine, mutate, push],
  );

  /*
   * Settle the whole account, once per sign-in.
   *
   * Guarded by the token so it runs again for a different account, and
   * cancelled on unmount so a slow response cannot write one account's
   * settings into another's engine — the same hazard as the sync layer's
   * store check, and for the same reason.
   *
   * Every language, not just the open one. The split put each language in its
   * own resource precisely so they could differ; reconciling one of them meant
   * a second language arrived at the defaults on a new device while the first
   * arrived correct — the half-working kind of wrong that is hardest to spot.
   */
  useEffect(() => {
    if (!token || !hasBackend) return;
    if (reconciled.current.token !== token) {
      reconciled.current = { token, user: false, languages: new Set() };
    }
    if (reconciled.current.user) return;
    reconciled.current.user = true;

    let cancelled = false;

    void (async () => {
      try {
        const [user, stored] = await Promise.all([
          api().getUserSettings(token),
          api().listLanguageSettings(token),
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

        // Down first: anything the account already knows about wins, and
        // `updateProfile` creates the profile, so a language started on
        // another device exists here rather than having to be rediscovered.
        for (const remote of stored.languages) {
          if (cancelled) return;
          reconciled.current.languages.add(remote.languageCode);
          await mutate((instance) =>
            instance.updateProfile(remote.languageCode, toProfilePatch(remote)),
          );
        }

        /*
         * Then up: anything this device has been studying that the account has
         * not been told about.
         *
         * Not reachable from the web app as it stands — the account gate means
         * no language can be set up before there is an account to set it up
         * on — so this is the symmetrical case rather than a fixed bug, and it
         * has no test for that reason. It earns its place because the gate is
         * conditional on there being a server at all, and because a client
         * without one (the widget, mobile) reaches this provider by the same
         * door.
         */
        for (const code of LANGUAGE_CODES) {
          if (cancelled) return;
          if (reconciled.current.languages.has(code) || !engine.hasProfile(code)) continue;
          reconciled.current.languages.add(code);
          const local = engine.getProfile(code);
          await push((bearer) => api().putLanguageSettings(bearer, code, toLanguageSettings(local)));
        }
      } catch (cause) {
        if (!cancelled) {
          reconciled.current.user = false;
          setError((cause as Error).message);
        }
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
      loadLanguage,
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
    [
      appearance,
      backdrop,
      dayStartHour,
      language,
      error,
      activeLanguage,
      engine,
      mutate,
      push,
      token,
      loadLanguage,
    ],
  );

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): SettingsValue {
  const context = useContext(SettingsContext);
  if (!context) throw new Error('useSettings must be used inside a SettingsProvider');
  return context;
}
