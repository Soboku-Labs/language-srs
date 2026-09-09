import { findExamLevel } from '../exams';
import type { Card, LexicalEntry, Timestamp } from '../types/card';
import type { CardKind, ExamLevel } from '../types/exam';
import { getLanguageProfile } from '../types/language';
import { cardId } from '../utils/id';
import { systemClock } from '../utils/date';

/**
 * Which prompts make sense for a given entry.
 *
 * The exam level says how much weight a card kind deserves; this says whether
 * the kind is possible at all for a particular word. Asking for the tone pattern
 * of a Japanese noun or a cloze sentence for an entry with no examples produces
 * a card that cannot be answered, so those are filtered out before generation
 * rather than papered over in the UI.
 */
export function isCardKindApplicable(entry: LexicalEntry, kind: CardKind): boolean {
  const profile = getLanguageProfile(entry.languageCode);

  switch (kind) {
    case 'recognition':
    case 'production':
      return true;

    case 'listening':
      // No audioUrl requirement: platform text-to-speech covers entries without
      // recorded audio, and every one of these exams is heavily listening-based,
      // so dropping the kind for lack of a recording would be the wrong trade.
      return true;

    case 'reading':
      return entry.examples.length > 0;

    case 'writing':
      // Characters for Mandarin and Japanese, spelling from memory for Korean
      // and Vietnamese. Both are what the writing section actually asks for.
      return true;

    case 'grammar':
      return entry.tags.includes('grammar');

    case 'tone':
      return profile.tonal && Array.isArray(entry.tones) && entry.tones.length > 0;

    case 'script':
      return entry.tags.includes('script') || (entry.components?.length ?? 0) > 0;

    default:
      return false;
  }
}

export function createCard(entry: LexicalEntry, kind: CardKind, levelId: string, now: Timestamp): Card {
  return {
    id: cardId(entry.id, kind),
    entryId: entry.id,
    languageCode: entry.languageCode,
    levelId,
    kind,
    state: 'new',
    stability: 0,
    difficulty: 0,
    step: 0,
    due: now,
    scheduledDays: 0,
    reps: 0,
    lapses: 0,
    elapsedMs: 0,
    createdAt: now,
  };
}

export interface GenerateCardsOptions {
  now?: Timestamp;
  /**
   * Restrict generation to these kinds. Left unset, the exam level's own
   * weights decide, which is the exam-faithful default — a JLPT learner gets no
   * handwriting cards because the JLPT has no writing section.
   */
  enabledCardKinds?: CardKind[];
  /** Cards that already exist, so their memory state is preserved. */
  existing?: Card[];
}

/**
 * Cards for one entry, according to the exam level that introduces it.
 *
 * Idempotent: card ids are derived from `entryId:kind`, so re-running after a
 * level's weights change adds the newly-relevant kinds and leaves existing cards
 * — and their review history — untouched.
 *
 * An existing card is re-tagged to the level now introducing it. Card ids carry
 * no level, so without this a card stayed pinned to whichever scope first created
 * it, and the queue — which filters on `levelId` — stopped serving it the moment
 * that level left scope. Switching from HSK 3.0 to HSK 2.0 emptied the whole app
 * that way: every card still said `hsk3-1`, nothing matched `hsk2-1`, and the
 * dashboard cheerfully reported "all caught up". Only the tag moves; stability,
 * due date, reps and lapses are the learner's and are carried over untouched.
 */
export function generateCardsForEntry(
  entry: LexicalEntry,
  level: ExamLevel,
  options: GenerateCardsOptions = {},
): Card[] {
  const now = options.now ?? systemClock();
  const existingById = new Map((options.existing ?? []).map((card) => [card.id, card]));

  const weighted = Object.entries(level.cardWeights)
    .filter((entry_): entry_ is [CardKind, number] => typeof entry_[1] === 'number' && entry_[1] > 0)
    .map(([kind]) => kind);

  const allowed = options.enabledCardKinds
    ? weighted.filter((kind) => options.enabledCardKinds?.includes(kind))
    : weighted;

  return allowed
    .filter((kind) => isCardKindApplicable(entry, kind))
    .map((kind) => {
      const existing = existingById.get(cardId(entry.id, kind));
      if (!existing) return createCard(entry, kind, level.id, now);
      return existing.levelId === level.id ? existing : { ...existing, levelId: level.id };
    });
}

/**
 * Cards for a whole set of entries.
 *
 * Each entry is generated against the lowest level it belongs to that is in
 * scope, so a word introduced at HSK 2 keeps HSK 2's card mix even when the
 * learner is studying for HSK 4.
 */
export function generateCards(
  entries: LexicalEntry[],
  scopeLevelIds: string[],
  options: GenerateCardsOptions = {},
): Card[] {
  const scope = new Set(scopeLevelIds);
  const cards: Card[] = [];

  for (const entry of entries) {
    const levelId = entry.levelIds.find((id) => scope.has(id));
    if (!levelId) continue;
    const level = findExamLevel(levelId);
    if (!level) continue;
    cards.push(...generateCardsForEntry(entry, level, options));
  }

  return cards;
}
