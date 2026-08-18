import { findExamLevel, findExamTrack } from '../exams';
import { previewIntervals } from '../srs/scheduler';
import type { SchedulerConfig } from '../srs/params';
import type { Card, CardWithEntry, LexicalEntry, StudyProfile, Timestamp } from '../types/card';
import type { CardKind } from '../types/exam';
import { getLanguageProfile, type LanguageCode } from '../types/language';
import { getLanguageTheme, type Palette } from '../theme/palettes';
import type { Rating } from '../types/review';
import { addDays, addMinutes, calendarDaysBetween } from '../utils/date';
import type { ExamReadiness } from '../stats/readiness';
import type { StreakInfo } from '../stats/metrics';
import type { QueueBreakdown } from '../session/queue';
import { linkToCard, linkToGrade, linkToHome, linkToReveal, linkToReview } from './deeplinks';

/**
 * The home-screen widget contract.
 *
 * The governing rule for everything in this file: **the widget renders, it does
 * not compute.** Swift and Kotlin receive a flat, fully-formatted snapshot and
 * do nothing but lay it out. No date maths, no interval formatting, no
 * pluralisation, no deciding which card comes next.
 *
 * That is not stylistic tidiness. A WidgetKit timeline provider gets a small
 * time budget and no access to the app's process, and Glance re-renders in a
 * remote process with the same constraints. Anything the native side has to
 * work out is logic that exists three times — TypeScript, Swift, Kotlin — and
 * drifts in two of them. Precomputing here means the scheduling behaviour a
 * learner sees on their home screen is the same code that runs in the app.
 *
 * That rule is also why the palettes travel in the payload. The Suboku system
 * (see `theme/palettes.ts`) is one neutral canvas with a single accent per
 * language, and the widget has to match the app it belongs to. Sending the
 * colours means Swift and Kotlin hold no palette of their own and cannot drift
 * when one is adjusted.
 *
 * Bump `WIDGET_SCHEMA_VERSION` on any breaking shape change: the native
 * decoders check it and fall back to a "tap to refresh" state rather than
 * crashing when an old widget binary meets a new payload.
 *
 * v2 added the `theme` block. v3 replaced it with both palettes at once, so the
 * widget can follow the home screen's own appearance.
 */
export const WIDGET_SCHEMA_VERSION = 3;

/** Widget sizes the payload is designed to fill. */
export type WidgetFamily =
  /** iOS systemSmall / Android 2x2: counts, streak, one glanceable figure. */
  | 'small'
  /** iOS systemMedium / Android 4x2: a card front plus grade buttons. */
  | 'medium'
  /** iOS systemLarge / Android 4x4: card, example sentence, readiness. */
  | 'large'
  /** iOS accessory (Lock Screen, watch complication): a single line of text. */
  | 'accessory';

/** A card flattened for rendering, with every string already formatted. */
export interface WidgetCard {
  cardId: string;
  entryId: string;
  kind: CardKind;
  /** What the widget shows before the answer is revealed. */
  prompt: string;
  /** Small print above the prompt, e.g. "HSK 3 · verb". */
  promptHint: string;
  /** Pronunciation, shown with the answer. */
  reading: string;
  /** The answer side, already joined into one string. */
  answer: string;
  /** One example sentence, for the large family. Empty when there is none. */
  example?: string;
  exampleTranslation?: string;
  /** Per-syllable tones for Mandarin and Vietnamese, so tones can be coloured. */
  tones?: number[];
  /** Grade buttons, in display order, with the interval each would produce. */
  options: WidgetGradeOption[];
  /** Link to open this card in the app. */
  deepLink: string;
  /** Link that reveals the answer in-app without grading. */
  revealLink: string;
}

export interface WidgetGradeOption {
  rating: Rating;
  /** "Again", "Hard", "Good", "Easy". */
  label: string;
  /** Resulting interval, pre-formatted: "10m", "4d", "1.2y". */
  interval: string;
  /** Fallback link for platforms that cannot grade in-process. */
  deepLink: string;
}

/** One mode's colours, already resolved. */
export interface WidgetPalette {
  canvas: string;
  surface: string;
  line: string;
  ink: string;
  inkMuted: string;
  accent: string;
  onAccent: string;
  /** Grade button colours, indexed by rating 1-4. */
  gradeColors: [string, string, string, string];
}

export interface WidgetCounts {
  due: number;
  fresh: number;
  learning: number;
  /** due + fresh + learning: the number on the badge. */
  total: number;
}

/**
 * One rendering of the widget at one instant.
 *
 * `validUntil` exists because WidgetKit asks for a timeline of future entries
 * rather than polling. See `buildWidgetTimeline`.
 */
export interface WidgetSnapshot {
  schemaVersion: number;
  generatedAt: Timestamp;
  /** When this entry should be replaced by the next one in the timeline. */
  validUntil: Timestamp;

  language: {
    code: LanguageCode;
    name: string;
    badge: string;
    emoji: string;
  };

  /**
   * Both palettes, flattened to hex strings.
   *
   * Light *and* dark, rather than whichever the app happened to be showing. A
   * widget sits on someone's home screen and follows the system appearance
   * independently of the app that wrote its payload — the app may not have been
   * opened since the phone last switched to dark mode. Sending both lets the
   * native side pick with its own environment and still compute nothing.
   */
  theme: {
    /** Accent name, e.g. "Cinnabar". The whole per-language identity. */
    accentName: string;
    light: WidgetPalette;
    dark: WidgetPalette;
    /** Corner radius for widget surfaces, in points/dp. */
    cornerRadius: number;
  };

  exam: {
    trackName: string;
    levelName: string;
    levelShortName: string;
    examDate?: string;
    daysToExam?: number;
    /** "HSK 4 in 23 days" or "HSK 4 — no date set". */
    caption: string;
  };

  counts: WidgetCounts;

  streak: {
    days: number;
    studiedToday: boolean;
    /** "12 day streak" / "Start your streak". */
    caption: string;
  };

  readiness: {
    /** 0-100, rounded, for a ring or bar. */
    percent: number;
    verdict: string;
    headline: string;
  };

  /** The card the learner would see next. Absent when nothing is due. */
  nextCard?: WidgetCard;

  /**
   * A word to show when nothing is due, so the widget stays useful instead of
   * going blank. Passive exposure between sessions is the cheapest study there
   * is, and it is the whole point of the accessory family.
   */
  spotlight?: WidgetCard;

  /** Primary call to action, pre-resolved per state. */
  action: {
    label: string;
    deepLink: string;
  };

  /** Headline for the empty state, e.g. "All clear — next review in 3h". */
  emptyStateCaption: string;
}

export interface BuildWidgetSnapshotInput {
  now: Timestamp;
  profile: StudyProfile;
  /** The queue as built by `buildStudyQueue`. */
  queue: { cards: CardWithEntry[]; breakdown: QueueBreakdown; nextDueAt?: Timestamp };
  streak: StreakInfo;
  readiness: ExamReadiness;
  /** Any card to feature when nothing is due — typically the least-recently-seen. */
  spotlight?: CardWithEntry;
  config?: Partial<SchedulerConfig>;
  /** How long this entry stays valid. Defaults to 30 minutes. */
  validForMinutes?: number;
}

export function buildWidgetSnapshot(input: BuildWidgetSnapshotInput): WidgetSnapshot {
  const { now, profile, queue, streak, readiness } = input;
  const language = getLanguageProfile(profile.languageCode);
  const track = findExamTrack(profile.examTrackId);
  const level = findExamLevel(profile.targetLevelId);

  const counts: WidgetCounts = {
    due: queue.breakdown.due,
    fresh: queue.breakdown.fresh,
    learning: queue.breakdown.learning,
    total: queue.breakdown.due + queue.breakdown.fresh + queue.breakdown.learning,
  };

  const head = queue.cards[0];
  const nextCard = head ? toWidgetCard(head, { now, profile, config: input.config }) : undefined;
  const spotlight = input.spotlight
    ? toWidgetCard(input.spotlight, { now, profile, config: input.config })
    : undefined;

  const daysToExam = profile.examDate ? calendarDaysBetween(now, profile.examDate) : undefined;

  const theme = getLanguageTheme(profile.languageCode);

  return {
    schemaVersion: WIDGET_SCHEMA_VERSION,
    generatedAt: now,
    validUntil: addMinutes(now, input.validForMinutes ?? 30),

    language: {
      code: language.code,
      name: language.name,
      badge: language.badge,
      emoji: language.emoji,
    },

    theme: {
      accentName: theme.accentName,
      light: toWidgetPalette(theme.light),
      dark: toWidgetPalette(theme.dark),
      cornerRadius: theme.radius.card,
    },

    exam: {
      trackName: track?.name ?? profile.examTrackId,
      levelName: level?.name ?? profile.targetLevelId,
      levelShortName: level?.shortName ?? profile.targetLevelId,
      ...(profile.examDate ? { examDate: profile.examDate } : {}),
      ...(daysToExam !== undefined ? { daysToExam } : {}),
      caption: buildExamCaption(level?.shortName ?? profile.targetLevelId, daysToExam),
    },

    counts,

    streak: {
      days: streak.current,
      studiedToday: streak.studiedToday,
      caption: streak.current > 0 ? `${streak.current} day streak` : 'Start your streak',
    },

    readiness: {
      percent: Math.round(readiness.score * 100),
      verdict: readiness.verdict,
      headline: readiness.headline,
    },

    ...(nextCard ? { nextCard } : {}),
    ...(spotlight ? { spotlight } : {}),

    action: buildAction(counts, profile.languageCode, nextCard),
    emptyStateCaption: buildEmptyStateCaption(counts, now, queue.nextDueAt),
  };
}

function toWidgetPalette(palette: Palette): WidgetPalette {
  return {
    canvas: palette.canvas,
    surface: palette.surface,
    line: palette.line,
    ink: palette.ink,
    inkMuted: palette.inkMuted,
    accent: palette.accent,
    onAccent: palette.onAccent,
    gradeColors: [palette.again, palette.hard, palette.good, palette.easy],
  };
}

function toWidgetCard(
  pair: CardWithEntry,
  context: { now: Timestamp; profile: StudyProfile; config?: Partial<SchedulerConfig> },
): WidgetCard {
  const { card, entry } = pair;
  const level = findExamLevel(card.levelId);
  const previews = previewIntervals(card, {
    now: context.now,
    ...(context.config ? { config: context.config } : {}),
    ...(context.profile.examDate ? { examDate: context.profile.examDate } : {}),
  });

  const ratings: Rating[] = [1, 2, 3, 4];
  const example = entry.examples[0];

  return {
    cardId: card.id,
    entryId: entry.id,
    kind: card.kind,
    prompt: promptFor(pair),
    promptHint: [level?.shortName, entry.partOfSpeech, kindLabel(card.kind)].filter(Boolean).join(' · '),
    reading: entry.reading,
    answer: entry.meanings.join(', '),
    ...(example ? { example: example.target, exampleTranslation: example.translation } : {}),
    ...(entry.tones ? { tones: entry.tones } : {}),
    options: ratings.map((rating) => ({
      rating,
      label: previews[rating].label,
      interval: previews[rating].display,
      deepLink: linkToGrade(card.id, rating),
    })),
    deepLink: linkToCard(card.id),
    revealLink: linkToReveal(card.id),
  };
}

/**
 * The prompt side depends on the card kind, and it has to be decided here.
 *
 * A production card that showed the target word would be giving away its own
 * answer — the sort of bug that is invisible in a screenshot and obvious after a
 * week of inflated retention figures.
 */
function promptFor({ card, entry }: CardWithEntry): string {
  switch (card.kind) {
    case 'production':
      return entry.meanings.join(', ');
    case 'listening':
      // Audio cannot autoplay from a widget, so the widget shows the reading and
      // the app plays it on open.
      return entry.reading;
    case 'reading':
      return entry.examples[0]?.target ?? entry.target;
    case 'tone':
      return entry.target;
    default:
      return entry.target;
  }
}

const KIND_LABELS: Record<CardKind, string> = {
  recognition: 'Meaning',
  production: 'Produce',
  listening: 'Listening',
  reading: 'In context',
  writing: 'Write it',
  grammar: 'Grammar',
  tone: 'Tones',
  script: 'Script',
};

export function kindLabel(kind: CardKind): string {
  return KIND_LABELS[kind] ?? kind;
}

function buildExamCaption(levelShortName: string, daysToExam?: number): string {
  if (daysToExam === undefined) return `${levelShortName} — no exam date set`;
  if (daysToExam < 0) return `${levelShortName} — exam date passed`;
  if (daysToExam === 0) return `${levelShortName} — exam today`;
  if (daysToExam === 1) return `${levelShortName} — exam tomorrow`;
  return `${levelShortName} in ${daysToExam} days`;
}

function buildAction(counts: WidgetCounts, languageCode: LanguageCode, nextCard?: WidgetCard) {
  if (counts.total === 0) {
    return { label: 'Open', deepLink: linkToHome() };
  }
  if (nextCard) {
    return { label: `Review ${counts.total}`, deepLink: nextCard.deepLink };
  }
  return { label: `Review ${counts.total}`, deepLink: linkToReview(languageCode) };
}

function buildEmptyStateCaption(counts: WidgetCounts, now: Timestamp, nextDueAt?: Timestamp): string {
  if (counts.total > 0) return '';
  if (!nextDueAt) return 'All clear. Add a level to keep going.';
  const hours = (Date.parse(nextDueAt) - Date.parse(now)) / 3_600_000;
  if (hours < 1) return 'All clear — more due within the hour';
  if (hours < 24) return `All clear — next review in ${Math.round(hours)}h`;
  return `All clear — next review in ${Math.round(hours / 24)}d`;
}

/**
 * A timeline of snapshots for WidgetKit.
 *
 * iOS does not let a widget poll. It asks for a series of entries with the times
 * they become current, renders them ahead of time, and swaps them in — so a
 * widget showing "4 due" needs to already know it will say "9 due" at 6pm when
 * more cards come due. Each entry is a full snapshot computed at that future
 * instant, which is only possible because the scheduler is pure and takes `now`
 * as an argument.
 *
 * Android's Glance re-renders on demand and only needs the first entry, but it
 * uses the same builder so both platforms show identical numbers.
 */
export interface WidgetTimeline {
  entries: WidgetSnapshot[];
  /** When the app should be asked to regenerate the whole timeline. */
  refreshAfter: Timestamp;
}

export interface BuildWidgetTimelineInput extends Omit<BuildWidgetSnapshotInput, 'now'> {
  now: Timestamp;
  /** Snapshot at each of these hour offsets from now. */
  hourOffsets?: number[];
  /**
   * Recompute the queue at a future instant. Supplied by the app, which owns
   * card storage; without it the timeline repeats the current counts and only
   * the captions advance.
   */
  projectQueue?: (at: Timestamp) => BuildWidgetSnapshotInput['queue'];
}

export function buildWidgetTimeline(input: BuildWidgetTimelineInput): WidgetTimeline {
  const offsets = input.hourOffsets ?? [0, 1, 3, 6, 12];
  const entries = offsets.map((hours, index) => {
    const at = addDays(input.now, hours / 24);
    const nextOffset = offsets[index + 1];
    const validForMinutes = nextOffset !== undefined ? (nextOffset - hours) * 60 : 60;
    const queue = input.projectQueue ? input.projectQueue(at) : input.queue;
    return buildWidgetSnapshot({ ...input, now: at, queue, validForMinutes });
  });

  return {
    entries,
    refreshAfter: addDays(input.now, (offsets[offsets.length - 1] ?? 12) / 24),
  };
}

/**
 * Pick a word to feature when nothing is due.
 *
 * Least recently reviewed among cards already in review, so the widget surfaces
 * something the learner has met before and is drifting away from, rather than
 * spoiling a card that has not been introduced yet.
 */
export function pickSpotlight(
  cards: Card[],
  entries: Map<string, LexicalEntry>,
  now: Timestamp,
): CardWithEntry | undefined {
  const candidates = cards
    .filter((card) => card.state === 'review' && !card.suspended && card.kind === 'recognition')
    .sort((a, b) => Date.parse(a.lastReviewedAt ?? a.createdAt) - Date.parse(b.lastReviewedAt ?? b.createdAt));

  for (const card of candidates) {
    const entry = entries.get(card.entryId);
    if (entry) return { card, entry };
  }

  // Nothing in review yet: fall back to any entry so a fresh install still has
  // something on the home screen.
  for (const card of cards) {
    const entry = entries.get(card.entryId);
    if (entry) return { card, entry };
  }

  return undefined;
}
