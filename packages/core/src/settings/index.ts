import type { CardKind } from '../types/exam';
import type { LanguageCode } from '../types/language';
import type { DateOnly, Timestamp } from '../types/card';

/**
 * Settings, separated by what they are actually about.
 *
 * Until now everything lived in one place: the engine's meta carried the
 * active language, the appearance, the backdrop and a profile per language,
 * and the server stored the lot as one opaque blob it could not read. That is
 * workable while there is one screen of settings and four languages. It stops
 * being workable the moment you want a dashboard per language, or a server
 * that can act on a preference, or twenty languages instead of four.
 *
 * The split is by subject, and the test for which side something belongs on is
 * simple: **would it still be true if you studied a different language?**
 *
 * - **User settings** — appearance, how much the background moves, when your
 *   day rolls over. These are about the person. Somebody who wants dark mode
 *   wants it in Korean too.
 * - **Language settings** — which exam, which level, when it is, how many new
 *   cards a day, how hard to push retention. These are about studying one
 *   language, and two languages genuinely disagree: a learner sitting HSK 4 in
 *   June and dabbling in Vietnamese wants very different numbers for each.
 *
 * `dayStartHour` is the one that moves. It used to sit on the per-language
 * profile, which meant changing it for Mandarin left Japanese rolling over at
 * a different hour — two study days in one app, for one person, in one
 * timezone. It is a property of the person.
 */

/**
 * Light or dark, or neither decided here.
 *
 * `system` is the default and follows the device, which is right for most
 * people most of the time. The two explicit settings exist because the device
 * is not always right: a phone that flips to dark at sunset is wrong for
 * somebody studying under a desk lamp, and the reverse is wrong on a train at
 * night.
 */
export type Appearance = 'system' | 'light' | 'dark';

/**
 * How alive the background is.
 *
 * Not a skin. The two settings are a real disagreement about what a study app
 * should be, and both sides of it are reasonable:
 *
 * - **calm** — the scene is a still drawing. It moves when the learner moves,
 *   and otherwise it is a picture on a wall. Nothing competes with the card.
 * - **living** — the weather runs. Cloud drifts, kites sway, water moves, the
 *   light shifts across the sky. It is the same place, awake.
 *
 * It belongs to the account rather than the browser, because somebody who
 * wants their app still wants it still on their phone too.
 */
export type Backdrop = 'calm' | 'living';

/** Settings about the person, not about any language. */
export interface UserSettings {
  appearance: Appearance;
  backdrop: Backdrop;
  /**
   * Hour the study day rolls over, 0-23.
   *
   * Four in the morning by default, so a late-night session counts towards the
   * day it started in rather than splitting a sitting across two days.
   */
  dayStartHour: number;
  updatedAt: Timestamp;
}

/** Settings about studying one language. */
export interface LanguageSettings {
  languageCode: LanguageCode;
  examTrackId: string;
  /** The level being studied for. Scope is this level and everything below it. */
  targetLevelId: string;
  /** Exam day, if booked. Switches the scheduler into exam mode. */
  examDate?: DateOnly;
  dailyNewLimit: number;
  dailyReviewLimit: number;
  /** Target recall probability when a card comes up, 0.7–0.98. */
  desiredRetention: number;
  /** Overrides the level's own weights. Unset is the exam-faithful choice. */
  enabledCardKinds?: CardKind[];
  updatedAt: Timestamp;
}

export const DEFAULT_USER_SETTINGS: Omit<UserSettings, 'updatedAt'> = {
  appearance: 'system',
  backdrop: 'calm',
  dayStartHour: 4,
};

/**
 * What a language starts at before anybody chooses anything.
 *
 * The track and level are deliberately absent: those depend on the language,
 * so they are filled in by whoever creates the settings rather than guessed at
 * here. Everything else is a number that is reasonable in any language.
 */
export const DEFAULT_LANGUAGE_SETTINGS: Omit<
  LanguageSettings,
  'languageCode' | 'examTrackId' | 'targetLevelId' | 'updatedAt'
> = {
  // Deliberately the same numbers as `DEFAULT_STUDY_PROFILE`. These started out
  // disagreeing — ten here, fifteen there — which meant a new language began at
  // a different pace depending on whether the server or the app got there
  // first. Two defaults for one setting is the drift this split exists to stop.
  dailyNewLimit: 15,
  dailyReviewLimit: 120,
  desiredRetention: 0.9,
};

/**
 * Bounds, in one place, because two sides enforce them.
 *
 * The app stops somebody typing 900 new cards a day, and the server has to
 * stop a client that does not. Stating the range once means those two cannot
 * drift into disagreeing about what is allowed.
 */
export const SETTINGS_LIMITS = {
  dayStartHour: { min: 0, max: 23 },
  dailyNewLimit: { min: 0, max: 500 },
  dailyReviewLimit: { min: 0, max: 2000 },
  desiredRetention: { min: 0.7, max: 0.98 },
} as const;

const APPEARANCES: Appearance[] = ['system', 'light', 'dark'];
const BACKDROPS: Backdrop[] = ['calm', 'living'];

function clamp(value: number, { min, max }: { min: number; max: number }): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Take what a client sent and return something storable.
 *
 * Deliberately forgiving rather than strict: an unknown appearance becomes the
 * default instead of a 400, and a daily limit of 10,000 is clamped rather than
 * rejected. A settings endpoint that refuses the whole request because one
 * field drifted is how a client update bricks the screen it is saving from.
 * What it will not do is invent a value for something absent — that keeps the
 * current one.
 */
export function normaliseUserSettings(
  input: Partial<UserSettings>,
  current: UserSettings,
): Omit<UserSettings, 'updatedAt'> {
  return {
    appearance:
      input.appearance && APPEARANCES.includes(input.appearance)
        ? input.appearance
        : current.appearance,
    backdrop:
      input.backdrop && BACKDROPS.includes(input.backdrop) ? input.backdrop : current.backdrop,
    dayStartHour:
      typeof input.dayStartHour === 'number' && Number.isFinite(input.dayStartHour)
        ? Math.round(clamp(input.dayStartHour, SETTINGS_LIMITS.dayStartHour))
        : current.dayStartHour,
  };
}

/**
 * What a client may send for a language.
 *
 * `examDate` widens to allow `null`, which is the only way to say "cancelled"
 * as opposed to "not mentioned". Leaving it out of the type meant the one
 * caller that needed it had to cast, which is the type system pointing out
 * that the contract was wrong rather than the caller.
 */
export type LanguageSettingsPatch = Partial<Omit<LanguageSettings, 'examDate'>> & {
  examDate?: DateOnly | null;
};

export function normaliseLanguageSettings(
  input: LanguageSettingsPatch,
  current: LanguageSettings,
): Omit<LanguageSettings, 'updatedAt'> {
  const number = (
    value: unknown,
    fallback: number,
    bounds: { min: number; max: number },
    round = true,
  ): number => {
    if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
    const held = clamp(value, bounds);
    return round ? Math.round(held) : held;
  };

  return {
    languageCode: current.languageCode,
    examTrackId:
      typeof input.examTrackId === 'string' && input.examTrackId ? input.examTrackId : current.examTrackId,
    targetLevelId:
      typeof input.targetLevelId === 'string' && input.targetLevelId
        ? input.targetLevelId
        : current.targetLevelId,
    // An absent date keeps the current one; null clears it, which is how an
    // exam gets cancelled rather than merely forgotten.
    ...(input.examDate === null
      ? {}
      : input.examDate !== undefined
        ? { examDate: input.examDate }
        : current.examDate !== undefined
          ? { examDate: current.examDate }
          : {}),
    dailyNewLimit: number(input.dailyNewLimit, current.dailyNewLimit, SETTINGS_LIMITS.dailyNewLimit),
    dailyReviewLimit: number(
      input.dailyReviewLimit,
      current.dailyReviewLimit,
      SETTINGS_LIMITS.dailyReviewLimit,
    ),
    desiredRetention: number(
      input.desiredRetention,
      current.desiredRetention,
      SETTINGS_LIMITS.desiredRetention,
      false,
    ),
    ...(Array.isArray(input.enabledCardKinds)
      ? { enabledCardKinds: input.enabledCardKinds }
      : current.enabledCardKinds
        ? { enabledCardKinds: current.enabledCardKinds }
        : {}),
  };
}
