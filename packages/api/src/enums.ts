import { Code, ConnectError } from '@connectrpc/connect';
import type {
  AnswerMode,
  CardKind,
  CardState,
  DeckStatus,
  LanguageCode,
  Rating,
  StudyMode,
} from '@mon/core';
import * as pb from './gen/mon/v1/mon_pb';

/**
 * The enum seam.
 *
 * The domain names its values in prose — `'recognition'`, `'relearning'`,
 * `'clear-leech'` — because that is what reads well in the code that does the
 * work. Protobuf names them as prefixed constants with a numbered wire form,
 * because that is what survives a field being renamed under a shipped iOS build.
 * Both are right; this file is the tax.
 *
 * Every mapping is declared in one direction and inverted mechanically. Writing
 * both tables out by hand is how `CARD_KIND_READING` ends up decoding to
 * `'writing'` on the way back — a bug that would silently drill the wrong skill
 * and show up in nobody's test.
 */

function invert<Domain extends string, Wire extends number>(
  table: Record<Domain, Wire>,
): Map<Wire, Domain> {
  return new Map(Object.entries(table).map(([domain, wire]) => [wire as Wire, domain as Domain]));
}

/**
 * An unknown enum value is a client talking about something this server does not
 * have — a newer app build, or a corrupted request. Either way, refusing is the
 * only honest answer: silently falling back to the zero value would schedule
 * *something*, which is worse than failing.
 */
function required<Wire extends number, Domain extends string>(
  reverse: Map<Wire, Domain>,
  value: Wire,
  field: string,
): Domain {
  const found = reverse.get(value);
  if (found === undefined) {
    throw new ConnectError(`Unknown ${field}: ${value}`, Code.InvalidArgument);
  }
  return found;
}

// ------------------------------------------------------------------- language

const LANGUAGE: Record<LanguageCode, pb.LanguageCode> = {
  zh: pb.LanguageCode.ZH,
  ja: pb.LanguageCode.JA,
  ko: pb.LanguageCode.KO,
  vi: pb.LanguageCode.VI,
};
const LANGUAGE_REVERSE = invert(LANGUAGE);

export const languageToPb = (code: LanguageCode): pb.LanguageCode => LANGUAGE[code];

/**
 * UNSPECIFIED means "whichever language they were last studying", which is what
 * a client that has only just launched can honestly say.
 */
export function languageFromPb(
  value: pb.LanguageCode,
  fallback: LanguageCode,
): LanguageCode {
  if (value === pb.LanguageCode.UNSPECIFIED) return fallback;
  return required(LANGUAGE_REVERSE, value, 'language_code');
}

/** Where there is no sensible fallback — setting the active language, say. */
export function languageFromPbStrict(value: pb.LanguageCode): LanguageCode {
  if (value === pb.LanguageCode.UNSPECIFIED) {
    throw new ConnectError('language_code is required.', Code.InvalidArgument);
  }
  return required(LANGUAGE_REVERSE, value, 'language_code');
}

// ----------------------------------------------------------------- card kind

const CARD_KIND: Record<CardKind, pb.CardKind> = {
  recognition: pb.CardKind.RECOGNITION,
  production: pb.CardKind.PRODUCTION,
  listening: pb.CardKind.LISTENING,
  reading: pb.CardKind.READING,
  writing: pb.CardKind.WRITING,
  grammar: pb.CardKind.GRAMMAR,
  tone: pb.CardKind.TONE,
  script: pb.CardKind.SCRIPT,
};
const CARD_KIND_REVERSE = invert(CARD_KIND);

export const cardKindToPb = (kind: CardKind): pb.CardKind => CARD_KIND[kind];

/** UNSPECIFIED is "no filter" on the queue, so it maps to undefined rather than failing. */
export function cardKindFromPb(value: pb.CardKind): CardKind | undefined {
  if (value === pb.CardKind.UNSPECIFIED) return undefined;
  return required(CARD_KIND_REVERSE, value, 'kind');
}

/** Where a kind is part of the data rather than a filter — a card off the wire. */
export function cardKindFromPbStrict(value: pb.CardKind): CardKind {
  if (value === pb.CardKind.UNSPECIFIED) {
    throw new ConnectError('kind is required.', Code.InvalidArgument);
  }
  return required(CARD_KIND_REVERSE, value, 'kind');
}

// ---------------------------------------------------------------- card state

const CARD_STATE: Record<CardState, pb.CardState> = {
  new: pb.CardState.NEW,
  learning: pb.CardState.LEARNING,
  review: pb.CardState.REVIEW,
  relearning: pb.CardState.RELEARNING,
};
const CARD_STATE_REVERSE = invert(CARD_STATE);

export const cardStateToPb = (state: CardState): pb.CardState => CARD_STATE[state];

export function cardStateFromPb(value: pb.CardState): CardState {
  if (value === pb.CardState.UNSPECIFIED) {
    throw new ConnectError('state is required.', Code.InvalidArgument);
  }
  return required(CARD_STATE_REVERSE, value, 'state');
}

// -------------------------------------------------------------------- rating

const RATING: Record<Rating, pb.Rating> = {
  1: pb.Rating.AGAIN,
  2: pb.Rating.HARD,
  3: pb.Rating.GOOD,
  4: pb.Rating.EASY,
};
const RATING_REVERSE = invert(RATING as Record<string, pb.Rating>);

export const ratingToPb = (rating: Rating): pb.Rating => RATING[rating];

export function ratingFromPb(value: pb.Rating): Rating {
  if (value === pb.Rating.UNSPECIFIED) {
    throw new ConnectError('rating is required.', Code.InvalidArgument);
  }
  return Number(required(RATING_REVERSE, value, 'rating')) as Rating;
}

// ---------------------------------------------------------------- study mode

const STUDY_MODE: Record<StudyMode, pb.StudyMode> = {
  due: pb.StudyMode.DUE,
  learn: pb.StudyMode.LEARN,
  cram: pb.StudyMode.CRAM,
};
const STUDY_MODE_REVERSE = invert(STUDY_MODE);

/** UNSPECIFIED is DUE, as the proto says: the mode a client gets by not choosing. */
export function studyModeFromPb(value: pb.StudyMode): StudyMode {
  if (value === pb.StudyMode.UNSPECIFIED) return 'due';
  return required(STUDY_MODE_REVERSE, value, 'mode');
}

// --------------------------------------------------------------- answer mode

const ANSWER_MODE: Record<AnswerMode, pb.AnswerMode> = {
  choice: pb.AnswerMode.CHOICE,
  typed: pb.AnswerMode.TYPED,
  tone: pb.AnswerMode.TONE,
  self: pb.AnswerMode.SELF,
};

const ANSWER_MODE_REVERSE = invert(ANSWER_MODE);

export const answerModeToPb = (mode: AnswerMode): pb.AnswerMode => ANSWER_MODE[mode];

export function answerModeFromPb(value: pb.AnswerMode): AnswerMode {
  // A question with no mode cannot be asked, so this one has no sensible
  // default to fall back to.
  if (value === pb.AnswerMode.UNSPECIFIED) {
    throw new ConnectError('mode is required.', Code.InvalidArgument);
  }
  return required(ANSWER_MODE_REVERSE, value, 'mode');
}

// --------------------------------------------------------------- deck status

const DECK_STATUS: Record<DeckStatus, pb.DeckStatus> = {
  new: pb.DeckStatus.NEW,
  learning: pb.DeckStatus.LEARNING,
  review: pb.DeckStatus.REVIEW,
  suspended: pb.DeckStatus.SUSPENDED,
};
const DECK_STATUS_REVERSE = invert(DECK_STATUS);

export const deckStatusToPb = (status: DeckStatus): pb.DeckStatus => DECK_STATUS[status];

/** UNSPECIFIED is "every status", which is what a deck screen opens on. */
export function deckStatusFromPb(value: pb.DeckStatus): DeckStatus | undefined {
  if (value === pb.DeckStatus.UNSPECIFIED) return undefined;
  return required(DECK_STATUS_REVERSE, value, 'status');
}
