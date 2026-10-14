import { Code, ConnectError, type HandlerContext, type ServiceImpl } from '@connectrpc/connect';
import {
  filterDeck,
  isLanguageCode,
  parseVocabularyCsv,
  parseVocabularyJson,
  type Account,
  type CardKind,
  type LexicalEntry,
  type StudyEngine,
  type StudyProfile,
} from '@mon/core';
import * as pb from '../gen/mon/v1/mon_pb.ts';
import { bearerFrom } from './auth.ts';
import {
  cardToPb,
  deckEntryToPb,
  entryToPb,
  goalToPb,
  importIssueToPb,
  journeyToPb,
  profileToPb,
  questionToPb,
  readinessToPb,
  statsToPb,
  strugglingToPb,
} from './convert.ts';
import {
  cardKindFromPb,
  deckStatusFromPb,
  languageFromPb,
  languageFromPbStrict,
  languageToPb,
  ratingFromPb,
  studyModeFromPb,
} from './enums.ts';
import { toConnectError } from './errors.ts';

/** What every study RPC is handed once the token has been checked. */
export interface StudyContext {
  account: Account;
  engine: StudyEngine;
  headers: Headers;
}

/** The handlers, written against a resolved account rather than a raw request. */
type StudyHandlers = {
  [Method in keyof ServiceImpl<typeof pb.StudyService>]: (
    request: Parameters<ServiceImpl<typeof pb.StudyService>[Method]>[0],
    context: StudyContext,
  ) => ReturnType<ServiceImpl<typeof pb.StudyService>[Method]>;
};

export interface StudyServiceOptions {
  /** Resolve a bearer token to an account, or undefined if it is unknown or stale. */
  verify(token: string | undefined): Promise<Account | undefined>;
  engineFor(account: Account): Promise<StudyEngine>;
}

/**
 * StudyService.
 *
 * Every response is assembled from `@mon/core`, so a SwiftUI or Compose client
 * renders what it is given and owns no scheduling logic of its own. The handlers
 * below contain no arithmetic for that reason: where one looks like it is
 * deciding something, it is translating an enum or choosing which engine method
 * to call.
 */
export function studyService(options: StudyServiceOptions): ServiceImpl<typeof pb.StudyService> {
  const handlers: StudyHandlers = {
    /**
     * Everything a home screen needs, in one call.
     *
     * `ensureProfile` rather than a failure for a language the learner has not
     * started: "what is my state in Korean" has an honest answer for someone who
     * has never studied Korean, and it is the default profile with no progress.
     * Every client's next move after asking would be to create it anyway.
     */
    async getState(request, { engine }) {
      const code = languageFromPb(request.languageCode, engine.activeLanguage);
      await engine.ensureProfile(code);

      return {
        languageCode: request.languageCode || pb.LanguageCode.UNSPECIFIED,
        profile: profileToPb(engine.getProfile(code)),
        goal: goalToPb(engine.getDailyGoal(code)),
        journey: journeyToPb(engine.getJourney(code)),
        stats: statsToPb(engine.getStats(code)),
        readiness: readinessToPb(engine.getReadiness(code)),
        availableWords: engine.getAvailableWordCount(code),
        studiedLanguages: engine.studiedLanguages.map(languageToPb),
      };
    },

    /** The cards to study, each already a question: mode, distractors and previews. */
    async getQueue(request, { engine }) {
      const code = languageFromPb(request.languageCode, engine.activeLanguage);
      await engine.ensureProfile(code);

      const kind = cardKindFromPb(request.kind);
      if (request.limit < 0) {
        throw new ConnectError('limit cannot be negative.', Code.InvalidArgument);
      }

      const { questions, queue } = engine.getQuestions({
        code,
        mode: studyModeFromPb(request.mode),
        ...(kind ? { kinds: [kind satisfies CardKind] } : {}),
        ...(request.limit > 0 ? { sessionLimit: request.limit } : {}),
      });

      return {
        questions: questions.map(questionToPb),
        due: queue.breakdown.due,
        fresh: queue.breakdown.fresh,
        learning: queue.breakdown.learning,
        heldByCap: queue.breakdown.heldByCap,
        nextDueAt: queue.nextDueAt ?? '',
      };
    },

    /**
     * Record gradings.
     *
     * A batch, each carrying when it actually happened, because the client may
     * have been offline when the learner did them. This is the RPC the whole
     * centralised-scheduler arrangement is built around: without it, an SRS that
     * lives behind a network stops working on the Underground.
     *
     * Two rules, both load-bearing:
     *
     * - **Applied in time order.** The scheduler's output depends on the order,
     *   and an offline queue arrives in whatever order the client stored it.
     * - **Reported per card.** One unknown id must not discard the other nineteen
     *   reviews a learner did on the train.
     */
    async submitGrades(request, { engine }) {
      if (request.grades.length === 0) {
        throw new ConnectError('Send at least one grade.', Code.InvalidArgument);
      }

      const now = engine.now();
      const failed: { cardId: string; reason: string }[] = [];

      const rows = request.grades.map((grade, index) => {
        // An empty graded_at means "now", so it is resolved before sorting
        // rather than after. Sorting the raw strings would file every unstamped
        // grading ahead of every stamped one, which is the opposite of true.
        const at = grade.gradedAt || now;
        return { grade, index, at };
      });

      rows.sort((left, right) => left.at.localeCompare(right.at) || left.index - right.index);

      let applied = 0;
      for (const { grade, at } of rows) {
        try {
          if (!grade.cardId) throw new ConnectError('Missing card_id.', Code.InvalidArgument);
          if (Number.isNaN(Date.parse(at))) {
            throw new ConnectError(`Unreadable graded_at: ${grade.gradedAt}`, Code.InvalidArgument);
          }

          await engine.grade(grade.cardId, ratingFromPb(grade.rating), {
            source: 'app',
            now: at,
            ...(grade.durationMs > 0 ? { durationMs: grade.durationMs } : {}),
          });
          applied += 1;
        } catch (cause) {
          failed.push({ cardId: grade.cardId, reason: (cause as Error).message });
        }
      }

      return {
        applied,
        failed,
        goal: goalToPb(engine.getDailyGoal()),
        journey: journeyToPb(engine.getJourney()),
      };
    },

    /**
     * The learner's words, for browsing rather than studying.
     *
     * Filtered here so the three clients cannot disagree about what "matches" a
     * query — the search normalises diacritics and readings, which is the kind of
     * thing each platform would get subtly differently.
     */
    async getDeck(request, { engine }) {
      const code = languageFromPb(request.languageCode, engine.activeLanguage);
      await engine.ensureProfile(code);

      const status = deckStatusFromPb(request.status);
      return {
        entries: filterDeck(engine.getDeck(code), {
          ...(request.query ? { query: request.query } : {}),
          ...(status ? { status } : {}),
        }).map(deckEntryToPb),
      };
    },

    async getStruggling(request, { engine }) {
      const code = languageFromPb(request.languageCode, engine.activeLanguage);
      await engine.ensureProfile(code);

      return {
        cards: engine
          .getStrugglingCards(code, request.limit > 0 ? { limit: request.limit } : {})
          .map(strugglingToPb),
      };
    },

    /**
     * Change part of a profile.
     *
     * The mask is honoured strictly: a client sends a whole profile and names the
     * fields it means, and nothing else is written. Without it, two devices with
     * stale copies would each overwrite the other's unrelated settings on every
     * save.
     */
    async updateProfile(request, { engine }) {
      const code = languageFromPb(request.languageCode, engine.activeLanguage);
      if (!request.profile) {
        throw new ConnectError('profile is required.', Code.InvalidArgument);
      }
      if (request.updateMask.length === 0) {
        throw new ConnectError(
          'update_mask is required; name the fields to write.',
          Code.InvalidArgument,
        );
      }

      return { profile: profileToPb(await engine.updateProfile(code, patchFrom(request))) };
    },

    async setActiveLanguage(request, { engine }) {
      const code = languageFromPbStrict(request.languageCode);
      await engine.setActiveLanguage(code);
      return { languageCode: request.languageCode };
    },

    /**
     * Import vocabulary.
     *
     * Takes already-parsed entries, or raw CSV/JSON with the parse done here.
     * Parsing server-side is what stops a Swift client needing its own CSV
     * reader — and with it, its own opinion about what a malformed row means.
     */
    async importVocabulary(request, { engine }) {
      if (request.source.case === 'entries') {
        const entries = request.source.value.entries.map(entryFromPb);
        const result = await engine.importEntries(entries);
        return { ...result, accepted: entries.length, rejected: 0, issues: [] };
      }

      const text = request.source.case === 'text' ? request.source.value : '';
      if (!text.trim()) {
        throw new ConnectError('Send either `entries` or `text`.', Code.InvalidArgument);
      }

      const code = languageFromPb(request.languageCode, engine.activeLanguage);
      const parsed =
        request.format === 'json'
          ? parseVocabularyJson(text)
          : parseVocabularyCsv(text, {
              languageCode: code,
              ...(request.defaultLevelId ? { defaultLevelId: request.defaultLevelId } : {}),
            });

      // Nothing usable is a success with the issues attached, not an error: the
      // client has to show the learner which rows were wrong and why. "6 rows
      // skipped" is not something anyone can fix; "row 41: unknown exam level
      // hsk3-9" is.
      if (parsed.entries.length === 0) {
        return {
          added: 0,
          replaced: 0,
          accepted: 0,
          rejected: parsed.rejected,
          issues: parsed.issues.map(importIssueToPb),
        };
      }

      return {
        ...(await engine.importEntries(parsed.entries)),
        accepted: parsed.accepted,
        rejected: parsed.rejected,
        issues: parsed.issues.map(importIssueToPb),
      };
    },

    async setNote(request, { engine }) {
      if (!request.entryId) throw new ConnectError('entry_id is required.', Code.InvalidArgument);

      await engine.setEntryNote(request.entryId, request.note);
      const entry = engine.getEntry(request.entryId);
      if (!entry) throw new ConnectError(`No entry ${request.entryId}.`, Code.NotFound);

      return { entry: entryToPb(entry) };
    },

    /** The card-level actions, one RPC, so a client needs no url-building rules. */
    async cardAction(request, { engine }) {
      switch (request.action) {
        case pb.CardAction.SUSPEND:
          await engine.setCardSuspended(requireCardId(request), true);
          break;
        case pb.CardAction.UNSUSPEND:
          await engine.setCardSuspended(requireCardId(request), false);
          break;
        case pb.CardAction.BURY:
          await engine.setCardBuried(requireCardId(request));
          break;
        case pb.CardAction.RESET:
          await engine.resetCard(requireCardId(request));
          break;
        case pb.CardAction.CLEAR_LEECH:
          await engine.clearLeech(requireCardId(request));
          break;
        case pb.CardAction.UNDO_LAST_GRADE:
          // The only action with nothing to say about a specific card: `ok` is
          // whether there was anything left to undo.
          return { ok: await engine.undoLastGrade() };
        default:
          throw new ConnectError(`Unknown action: ${request.action}`, Code.InvalidArgument);
      }

      // The card as it now stands, so the client can re-render the row it just
      // acted on without asking for the whole deck back.
      const card = engine.getAllCards().find((candidate) => candidate.id === request.cardId);
      return { ok: true, ...(card ? { card: cardToPb(card) } : {}) };
    },
  };

  return wrap(options, handlers);
}

/**
 * Resolve the token once, for every method.
 *
 * Written as a wrapper rather than as a `requireAccount(context)` call at the top
 * of each handler, because there are ten handlers and the tenth is the one
 * somebody forgets. There is no way to register a study RPC that skips this.
 */
function wrap(
  options: StudyServiceOptions,
  handlers: StudyHandlers,
): ServiceImpl<typeof pb.StudyService> {
  const resolve = async (context: HandlerContext): Promise<StudyContext> => {
    const account = await options.verify(bearerFrom(context));
    if (!account) throw new ConnectError('Sign in first.', Code.Unauthenticated);
    return { account, engine: await options.engineFor(account), headers: context.requestHeader };
  };

  const entries = Object.entries(handlers).map(([name, handler]) => [
    name,
    async (request: never, context: HandlerContext) => {
      try {
        return await (handler as (request: never, study: StudyContext) => unknown)(
          request,
          await resolve(context),
        );
      } catch (cause) {
        throw toConnectError(cause, `StudyService/${name}`);
      }
    },
  ]);

  // `Object.fromEntries` cannot carry the per-method types through. The cast is
  // confined to this line; `handlers` above is fully checked, which is where a
  // mistake would actually be made.
  return Object.fromEntries(entries) as ServiceImpl<typeof pb.StudyService>;
}

function requireCardId(request: { cardId: string }): string {
  if (!request.cardId) {
    throw new ConnectError('card_id is required for this action.', Code.InvalidArgument);
  }
  return request.cardId;
}

/** The subset of `StudyProfile` a client may write, built from the mask. */
function patchFrom(request: {
  profile?: { [key: string]: unknown } | undefined;
  updateMask: string[];
}): Partial<Omit<StudyProfile, 'languageCode'>> {
  const profile = request.profile as Record<string, unknown>;
  const patch: Record<string, unknown> = {};

  for (const field of request.updateMask) {
    const name = camel(field);
    if (!WRITABLE.has(name)) {
      throw new ConnectError(`${field} is not a writable profile field.`, Code.InvalidArgument);
    }
    // An empty exam date is how a client clears one, and the proto has no way to
    // say "absent" for a string — so it maps to undefined rather than to "".
    patch[name] = name === 'examDate' && !profile[name] ? undefined : profile[name];
  }

  return patch as Partial<Omit<StudyProfile, 'languageCode'>>;
}

/**
 * What a client may change.
 *
 * `languageCode` is not here: it is the profile's identity, and a masked write
 * of it would silently move settings between languages. `createdAt` and
 * `updatedAt` belong to the server.
 */
const WRITABLE = new Set([
  'examTrackId',
  'targetLevelId',
  'examDate',
  'dailyNewLimit',
  'dailyReviewLimit',
  'desiredRetention',
  'dayStartHour',
]);

const camel = (field: string): string => field.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());

function entryFromPb(entry: pb.LexicalEntry): LexicalEntry {
  const code = languageFromPbStrict(entry.languageCode);
  return {
    id: entry.id,
    languageCode: code,
    target: entry.target,
    reading: entry.reading,
    meanings: entry.meanings,
    ...(entry.partOfSpeech ? { partOfSpeech: entry.partOfSpeech } : {}),
    levelIds: entry.levelIds,
    examples: entry.examples.map((example) => ({
      target: example.target,
      ...(example.reading ? { reading: example.reading } : {}),
      translation: example.translation,
    })),
    ...(entry.tones.length > 0 ? { tones: entry.tones } : {}),
    ...(entry.components.length > 0 ? { components: entry.components } : {}),
    ...(entry.frequencyRank > 0 ? { frequencyRank: entry.frequencyRank } : {}),
    ...(entry.mnemonic ? { mnemonic: entry.mnemonic } : {}),
    tags: entry.tags,
  };
}
