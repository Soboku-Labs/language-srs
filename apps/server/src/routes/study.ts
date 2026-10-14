import {
  LANGUAGE_CODES,
  STUDY_MODES,
  isLanguageCode,
  parseVocabularyCsv,
  parseVocabularyJson,
  type CardKind,
  type LanguageCode,
  type Rating,
  type StudyMode,
} from '@mon/core';
import { HttpError, type Handler, type RequestContext } from '../app.ts';

/**
 * The study API.
 *
 * Every response is assembled from the engine, so a Swift or Kotlin client
 * renders what it is given and owns no scheduling logic of its own. The shapes
 * are the core's own types wherever possible rather than a parallel set of
 * DTOs — a second vocabulary for the same concepts is a second thing to keep in
 * step.
 */
export function studyRoutes(): Record<string, Handler> {
  return {
    /**
     * Everything a home screen needs, in one call.
     *
     * Deliberately one round trip. A client on a train assembling a dashboard
     * from six requests shows six loading states and fails in six ways.
     */
    'GET /study/state': async ({ engine, url }) => {
      const code = language(url, engine.activeLanguage);
      return {
        languageCode: code,
        profile: engine.getProfile(code),
        goal: engine.getDailyGoal(code),
        journey: engine.getJourney(code),
        stats: engine.getStats(code),
        readiness: engine.getReadiness(code),
        queue: { breakdown: engine.getQueue({ code }).breakdown },
        availableWords: engine.getAvailableWordCount(code),
        studiedLanguages: engine.studiedLanguages,
      };
    },

    /** The cards to study, with their entries, so the client needs no second lookup. */
    'GET /study/queue': async ({ engine, url }) => {
      const code = language(url, engine.activeLanguage);
      const mode = url.searchParams.get('mode');
      const kind = url.searchParams.get('kind');

      const queue = engine.getQueue({
        code,
        ...(STUDY_MODES.includes(mode as StudyMode) ? { mode: mode as StudyMode } : {}),
        ...(kind ? { kinds: [kind as CardKind] } : {}),
        ...(url.searchParams.has('limit')
          ? { sessionLimit: positiveInt(url.searchParams.get('limit'), 'limit') }
          : {}),
      });

      return { cards: queue.cards, breakdown: queue.breakdown, kindMix: queue.kindMix, nextDueAt: queue.nextDueAt };
    },

    /**
     * Record gradings.
     *
     * A batch, each carrying when it actually happened, because the client may
     * have been offline when the learner did them. Replaying with the real
     * instants keeps the schedule honest — grading a card at the moment the
     * signal returned would tell FSRS the learner waited three hours.
     *
     * Applied in time order and reported individually: one unknown card id in a
     * batch of twenty must not discard the other nineteen.
     */
    'POST /study/grades': async ({ engine, body }) => {
      const grades = normaliseGrades(body);
      const applied: { cardId: string; ok: boolean; error?: string }[] = [];

      for (const grade of grades) {
        try {
          await engine.grade(grade.cardId, grade.rating, {
            source: grade.source ?? 'app',
            ...(grade.gradedAt ? { now: grade.gradedAt } : {}),
            ...(grade.durationMs !== undefined ? { durationMs: grade.durationMs } : {}),
          });
          applied.push({ cardId: grade.cardId, ok: true });
        } catch (cause) {
          applied.push({ cardId: grade.cardId, ok: false, error: (cause as Error).message });
        }
      }

      return {
        applied: applied.filter((row) => row.ok).length,
        failed: applied.filter((row) => !row.ok),
        goal: engine.getDailyGoal(),
        journey: engine.getJourney(),
      };
    },

    'GET /study/deck': async ({ engine, url }) => ({
      deck: engine.getDeck(language(url, engine.activeLanguage)),
    }),

    'GET /study/struggling': async ({ engine, url }) => ({
      struggling: engine.getStrugglingCards(language(url, engine.activeLanguage)),
    }),

    'PATCH /study/profile': async ({ engine, url, body }) => {
      const code = language(url, engine.activeLanguage);
      if (typeof body !== 'object' || body === null) {
        throw new HttpError(400, 'invalid-body', 'Expected a JSON object.');
      }
      return { profile: await engine.updateProfile(code, body as never) };
    },

    'POST /study/language': async ({ engine, body }) => {
      const code = (body as { languageCode?: string })?.languageCode;
      if (!code || !isLanguageCode(code)) {
        throw new HttpError(400, 'invalid-language', `languageCode must be one of ${LANGUAGE_CODES.join(', ')}`);
      }
      await engine.setActiveLanguage(code);
      return { languageCode: code };
    },

    /**
     * Import vocabulary.
     *
     * Takes already-parsed entries, or raw CSV/JSON text with the parse done
     * here. Parsing server-side is what stops a Swift client needing its own
     * CSV reader — and with it, its own opinion about what a malformed row means.
     */
    'POST /study/import': async ({ engine, body }) => {
      const input = (body ?? {}) as {
        entries?: unknown[];
        text?: string;
        format?: 'csv' | 'json';
        languageCode?: string;
        defaultLevelId?: string;
      };

      if (Array.isArray(input.entries)) {
        return { ...(await engine.importEntries(input.entries as never)), issues: [] };
      }

      if (typeof input.text !== 'string' || input.text.trim().length === 0) {
        throw new HttpError(400, 'invalid-body', 'Send either `entries` or `text`.');
      }

      const parsed =
        input.format === 'json'
          ? parseVocabularyJson(input.text)
          : parseVocabularyCsv(input.text, {
              languageCode: (isLanguageCode(input.languageCode ?? '')
                ? input.languageCode
                : engine.activeLanguage) as LanguageCode,
              ...(input.defaultLevelId ? { defaultLevelId: input.defaultLevelId } : {}),
            });

      // Nothing usable is a 200 with the issues attached, not an error: the
      // client needs to show the learner which rows were wrong and why.
      if (parsed.entries.length === 0) {
        return { added: 0, replaced: 0, accepted: 0, rejected: parsed.rejected, issues: parsed.issues };
      }

      return {
        ...(await engine.importEntries(parsed.entries)),
        accepted: parsed.accepted,
        rejected: parsed.rejected,
        issues: parsed.issues,
      };
    },

    'POST /study/note': async ({ engine, body }) => {
      const input = (body ?? {}) as { entryId?: string; note?: string };
      if (!input.entryId) throw new HttpError(400, 'invalid-body', 'Missing entryId.');
      await engine.setEntryNote(input.entryId, input.note ?? '');
      return { entry: engine.getEntry(input.entryId) };
    },

    /** The card-level actions, one route, so a client needs no url-building rules. */
    'POST /study/cards/:id/action': async (context) => {
      const cardId = cardIdFrom(context);
      const action = (context.body as { action?: string })?.action;

      switch (action) {
        case 'suspend':
          await context.engine.setCardSuspended(cardId, true);
          break;
        case 'unsuspend':
          await context.engine.setCardSuspended(cardId, false);
          break;
        case 'bury':
          await context.engine.setCardBuried(cardId);
          break;
        case 'reset':
          await context.engine.resetCard(cardId);
          break;
        case 'clear-leech':
          await context.engine.clearLeech(cardId);
          break;
        case 'undo': {
          const undone = await context.engine.undoLastGrade();
          return { undone };
        }
        default:
          throw new HttpError(
            400,
            'unknown-action',
            'action must be suspend, unsuspend, bury, reset, clear-leech or undo.',
          );
      }

      return { ok: true };
    },
  };
}

function language(url: URL, fallback: LanguageCode): LanguageCode {
  const code = url.searchParams.get('language');
  if (!code) return fallback;
  if (!isLanguageCode(code)) {
    throw new HttpError(400, 'invalid-language', `Unknown language ${code}.`);
  }
  return code;
}

function cardIdFrom({ url }: RequestContext): string {
  const match = /^\/study\/cards\/([^/]+)\//.exec(url.pathname);
  const id = match?.[1];
  if (!id) throw new HttpError(400, 'invalid-card', 'No card id in the path.');
  return decodeURIComponent(id);
}

function positiveInt(value: string | null, field: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new HttpError(400, 'invalid-query', `${field} must be a positive integer.`);
  }
  return parsed;
}

interface IncomingGrade {
  cardId: string;
  rating: Rating;
  gradedAt?: string;
  durationMs?: number;
  source?: 'app' | 'widget';
}

/** Accepts one grading or a batch, and rejects anything the scheduler cannot use. */
function normaliseGrades(body: unknown): IncomingGrade[] {
  const raw = Array.isArray(body) ? body : ((body as { grades?: unknown })?.grades ?? [body]);
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new HttpError(400, 'invalid-body', 'Send a grading, or a `grades` array.');
  }

  return raw.map((entry, index) => {
    const row = entry as Partial<IncomingGrade>;
    if (!row?.cardId) throw new HttpError(400, 'invalid-grade', `Grade ${index} has no cardId.`);
    if (![1, 2, 3, 4].includes(row.rating as number)) {
      throw new HttpError(400, 'invalid-grade', `Grade ${index} has rating ${row.rating}; expected 1-4.`);
    }
    if (row.gradedAt !== undefined && Number.isNaN(Date.parse(row.gradedAt))) {
      throw new HttpError(400, 'invalid-grade', `Grade ${index} has an unreadable gradedAt.`);
    }
    return row as IncomingGrade;
  })
    // Offline batches arrive in whatever order the client stored them; the
    // scheduler's state depends on the order they are applied.
    .sort((a, b) => (a.gradedAt ?? '').localeCompare(b.gradedAt ?? ''));
}
