import { findExamLevel, getLevelIdsInScope, getTrackForLevel } from '../exams';
import type { LexicalEntry, Timestamp } from '../types/card';
import { usesCharacterWriting, type LanguageCode } from '../types/language';

/**
 * Writing practice, organised the way practice is actually sold: as books.
 *
 * A book is a level. A chapter is a page of it. That is not a metaphor laid
 * over the data — it is how the exams themselves are published and how every
 * character workbook on a shelf is arranged, and it gives writing practice the
 * one thing a review queue cannot: a place you are *up to*, that stays where
 * you left it.
 *
 * ## Why this is not the review queue
 *
 * The queue is scheduling: it decides what you see and when, and it is right
 * to. Handwriting wants the opposite — the same twelve characters, in order,
 * as many times as you like, with the ones you have done marked off. Somebody
 * working through a workbook on an iPad is not asking an algorithm what to
 * write next. So a chapter is a fixed, ordered list, and progress through it is
 * a count rather than a schedule.
 *
 * The scheduler still owns the `writing` card kind and still brings characters
 * back at the right interval. These are two different activities on the same
 * vocabulary, and both are worth having.
 *
 * ## Generated, not written
 *
 * Chapters are cut from the syllabus the app already has, so a book exists for
 * every level of every track without anybody authoring content. When bought
 * books arrive they are the same shape with their own entries — `source` is
 * what will tell them apart, and the screens already render by this interface
 * rather than by where it came from.
 */

export type BookSource = 'syllabus' | 'purchased';

/**
 * One thing to write: a single character, and the word it came from.
 *
 * A character, not a word. The first version cut chapters from entries, so a
 * page asked for 你好 — two characters — in one square meant for one, and the
 * guide behind it overflowed the pad and ran across the footer. That was a
 * layout symptom of a modelling mistake: this is character practice, and the
 * unit of character practice is a character.
 *
 * The word is carried along because 你 on its own is not "hello" — showing the
 * gloss of the word it came from, with the character picked out of it, is the
 * difference between practice and a flashcard with the wrong answer on it.
 */
export interface WritingItem {
  /** The single character to write. */
  character: string;
  /** The entry it was taken from, for the reading and the gloss. */
  entryId: string;
}

export interface Chapter {
  id: string;
  /** Position in the book, from 1. */
  number: number;
  title: string;
  /** The characters to write, in order. */
  items: WritingItem[];
}

export interface Book {
  id: string;
  languageCode: LanguageCode;
  /** The exam level this book covers. */
  levelId: string;
  title: string;
  /** One line: what is in it. */
  line: string;
  source: BookSource;
  chapters: Chapter[];
}

/**
 * Characters per chapter.
 *
 * Twelve is about a sitting. Few enough that finishing one is a thing that
 * happens on a bus, which is what makes somebody open it again; more than
 * twenty and a chapter becomes a project you have to find time for, and the
 * ones nobody finishes are the ones nobody starts.
 */
export const CHAPTER_SIZE = 12;

/** Progress through one chapter, as a count rather than a schedule. */
export interface ChapterProgress {
  /** Characters written at least once. */
  written: string[];
  lastWrittenAt?: Timestamp;
}

/**
 * Whether this is a character somebody would practise writing.
 *
 * CJK ideographs and the Korean syllable blocks. Deliberately excludes the
 * Latin letters, digits and punctuation that turn up in vocabulary lists —
 * nobody needs a full page to practise a comma, and a chapter padded with
 * them is a chapter that wastes somebody's afternoon.
 *
 * Kana are excluded too: they are learned as a set in a few sittings rather
 * than drilled one page at a time, and a Japanese book full of を would bury
 * the kanji that are the actual work.
 */
export function isPractisableCharacter(character: string): boolean {
  const code = character.codePointAt(0) ?? 0;
  return (
    // CJK unified ideographs, and the extension A block.
    (code >= 0x4e00 && code <= 0x9fff) ||
    (code >= 0x3400 && code <= 0x4dbf) ||
    // Hangul syllables.
    (code >= 0xac00 && code <= 0xd7a3)
  );
}

/**
 * The books for a language, one per level in the current scope.
 *
 * Only for languages whose script has characters to recall stroke by stroke.
 * Vietnamese is written in a Latin alphabet, where copying a word out is
 * handwriting practice in the same sense that copying out an English word is:
 * real, but not what this is for.
 */
export function buildBooks(
  languageCode: LanguageCode,
  targetLevelId: string,
  entries: LexicalEntry[],
): Book[] {
  if (!usesCharacterWriting(languageCode)) return [];

  const scope = getLevelIdsInScope(targetLevelId);
  const byLanguage = entries.filter((entry) => entry.languageCode === languageCode);

  return scope
    .map((levelId) => buildBook(languageCode, levelId, byLanguage))
    .filter((book): book is Book => book !== undefined);
}

function buildBook(
  languageCode: LanguageCode,
  levelId: string,
  entries: LexicalEntry[],
): Book | undefined {
  const level = findExamLevel(levelId);
  if (!level) return undefined;

  /*
   * Only the entries this level introduces, not everything below it.
   *
   * A book per level that each contained the whole cumulative scope would
   * mean HSK 3's book repeating HSK 1's and HSK 2's, so the same character
   * appears in three books and finishing one tells you nothing.
   */
  const own = entries.filter((entry) => entry.levelIds.includes(levelId));
  if (own.length === 0) return undefined;

  /*
   * Every distinct character, in the order the words introduce them.
   *
   * Deduplicated across the whole book: 你 is in 你好 and in 你们, and a
   * workbook that asked for it twice would be padding. The first word to use
   * it is the one that carries it, which is also the one a learner met first.
   */
  const seen = new Set<string>();
  const items: WritingItem[] = [];
  for (const entry of own) {
    for (const character of [...entry.target]) {
      if (!isPractisableCharacter(character) || seen.has(character)) continue;
      seen.add(character);
      items.push({ character, entryId: entry.id });
    }
  }
  if (items.length === 0) return undefined;

  const chapters: Chapter[] = [];
  for (let start = 0; start < items.length; start += CHAPTER_SIZE) {
    const slice = items.slice(start, start + CHAPTER_SIZE);
    const number = chapters.length + 1;
    chapters.push({
      id: `${levelId}:ch${number}`,
      number,
      // Named by what is in it rather than "Chapter 3", so the list is
      // scannable when you are looking for where you got to.
      title: `${slice[0]!.character} – ${slice[slice.length - 1]!.character}`,
      items: slice,
    });
  }

  const track = getTrackForLevel(levelId);

  return {
    id: `book:${levelId}`,
    languageCode,
    levelId,
    title: `${level.name} writing`,
    line:
      items.length === 1
        ? `One character from ${track.name}.`
        : `${items.length} characters from ${track.name}, in ${chapters.length} chapter${
            chapters.length === 1 ? '' : 's'
          }.`,
    source: 'syllabus',
    chapters,
  };
}

/** How far through a chapter somebody is, 0–1. */
export function chapterFraction(chapter: Chapter, progress: ChapterProgress | undefined): number {
  if (chapter.items.length === 0) return 0;
  const written = new Set(progress?.written ?? []);
  const done = chapter.items.filter((item) => written.has(item.character)).length;
  return done / chapter.items.length;
}

/** How far through a whole book, weighted by chapter length rather than count. */
export function bookFraction(
  book: Book,
  progress: Record<string, ChapterProgress | undefined>,
): number {
  const total = book.chapters.reduce((sum, chapter) => sum + chapter.items.length, 0);
  if (total === 0) return 0;

  const done = book.chapters.reduce((sum, chapter) => {
    const written = new Set(progress[chapter.id]?.written ?? []);
    return sum + chapter.items.filter((item) => written.has(item.character)).length;
  }, 0);

  return done / total;
}

/**
 * Where to carry on.
 *
 * The first chapter with anything left in it, rather than the first unstarted
 * one — somebody who did half of chapter two wants chapter two, not chapter
 * three. Undefined when the book is finished.
 */
export function nextChapter(
  book: Book,
  progress: Record<string, ChapterProgress | undefined>,
): Chapter | undefined {
  return book.chapters.find((chapter) => chapterFraction(chapter, progress[chapter.id]) < 1);
}
