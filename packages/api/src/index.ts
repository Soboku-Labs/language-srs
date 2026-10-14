/**
 * @mon/api — the contract, the mapping, and the client.
 *
 * One package rather than three, because the three things only make sense
 * together: the generated types are useless without the enum tables that turn
 * `CARD_KIND_READING` into `'reading'`, and those tables must exist exactly once
 * or one direction will quietly disagree with the other.
 *
 * The server imports the encoders. The web app imports the decoders and the
 * client. Both import the generated service descriptors, which is what makes
 * them the same API rather than two things that resemble each other.
 */

// The contract, as generated. Re-exported as a namespace so call sites read
// `pb.LanguageCode.ZH` and nothing has to re-export every message by hand.
export * as pb from './gen/mon/v1/mon_pb';

// Enums, both directions, from one table each.
export {
  answerModeFromPb,
  answerModeToPb,
  cardKindFromPb,
  cardKindFromPbStrict,
  cardKindToPb,
  cardStateFromPb,
  cardStateToPb,
  deckStatusFromPb,
  deckStatusToPb,
  languageFromPb,
  languageFromPbStrict,
  languageToPb,
  ratingFromPb,
  ratingToPb,
  studyModeFromPb,
} from './enums';

// Domain to wire, for the backend.
export {
  accountToPb,
  cardToPb,
  deckEntryToPb,
  entryToPb,
  goalToPb,
  importIssueToPb,
  journeyToPb,
  profileToPb,
  questionToPb,
  readinessToPb,
  reviewLogToPb,
  sessionToPb,
  statsToPb,
  strugglingToPb,
} from './convert';
export type { SessionLike } from './convert';

// Wire to domain, for a client that keeps its own copy.
export { cardFromPb, entryFromPb, profileFromPb, reviewLogFromPb } from './decode';

// Auth, as the core's provider port.
export { ConnectAuthProvider } from './auth-provider';

// The client.
export { createMonClient, isRetryable } from './client';
export type { MonClient, MonClientOptions, TokenStore } from './client';

// Sync.
export { describeSyncFailure, lastSyncedAt, resetSyncRecord, sync } from './sync';
export type { SyncOptions, SyncResult } from './sync';
