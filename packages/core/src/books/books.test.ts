import { describe, expect, it } from 'vitest';
import { SEED_ENTRIES } from '../data/seed';
import {
  CHAPTER_SIZE,
  bookFraction,
  buildBooks,
  chapterFraction,
  nextChapter,
  type ChapterProgress,
} from './index';

const zh = () => buildBooks('zh', 'hsk3-1', SEED_ENTRIES);

describe('writing books', () => {
  it('builds a book per level in scope', () => {
    const books = zh();
    expect(books.length).toBeGreaterThan(0);
    for (const book of books) {
      expect(book.languageCode).toBe('zh');
      expect(book.chapters.length).toBeGreaterThan(0);
    }
  });

  it('never gives the same character to two books', () => {
    // A book per level that carried the whole cumulative scope would repeat
    // every lower level, so finishing one would tell you nothing.
    const seen = new Set<string>();
    for (const book of zh()) {
      for (const chapter of book.chapters) {
        for (const item of chapter.items) {
          expect(seen.has(item.character), `${item.character} is in two books`).toBe(false);
          seen.add(item.character);
        }
      }
    }
  });

  it('cuts chapters to a sitting', () => {
    for (const book of zh()) {
      for (const chapter of book.chapters) {
        expect(chapter.items.length).toBeGreaterThan(0);
        expect(chapter.items.length).toBeLessThanOrEqual(CHAPTER_SIZE);
      }
    }
  });

  it('numbers chapters from one, in order', () => {
    for (const book of zh()) {
      expect(book.chapters.map((chapter) => chapter.number)).toEqual(
        book.chapters.map((_, index) => index + 1),
      );
    }
  });

  it('offers nothing for a language written in a Latin alphabet', () => {
    // Copying out a Vietnamese word is handwriting in the same sense that
    // copying out an English one is: real, but not what this is for.
    expect(buildBooks('vi', 'vsl-1', SEED_ENTRIES)).toEqual([]);
  });

  it('measures a chapter by what has been written', () => {
    const chapter = zh()[0]!.chapters[0]!;
    expect(chapterFraction(chapter, undefined)).toBe(0);

    const half: ChapterProgress = {
      written: chapter.items.slice(0, Math.ceil(chapter.items.length / 2)).map((i) => i.character),
    };
    expect(chapterFraction(chapter, half)).toBeGreaterThan(0.4);
    expect(chapterFraction(chapter, half)).toBeLessThanOrEqual(0.6);

    expect(chapterFraction(chapter, { written: chapter.items.map((i) => i.character) })).toBe(1);
  });

  it('ignores progress for characters that are not in the chapter', () => {
    const chapter = zh()[0]!.chapters[0]!;
    expect(chapterFraction(chapter, { written: ['not-in-this-book', 'nor-this'] })).toBe(0);
  });

  it('weights a book by characters rather than by chapter count', () => {
    const book = zh()[0]!;
    const progress: Record<string, ChapterProgress> = {};
    for (const chapter of book.chapters) progress[chapter.id] = { written: chapter.items.map((i) => i.character) };
    expect(bookFraction(book, progress)).toBe(1);
    expect(bookFraction(book, {})).toBe(0);
  });

  it('carries on at the chapter that is half done, not the next untouched one', () => {
    const book = zh()[0]!;
    if (book.chapters.length < 2) return;

    const [first, second] = book.chapters;
    const progress: Record<string, ChapterProgress> = {
      [first!.id]: { written: first!.items.map((i) => i.character) },
      [second!.id]: { written: second!.items.slice(0, 1).map((i) => i.character) },
    };
    expect(nextChapter(book, progress)?.id).toBe(second!.id);
  });

  it('has nowhere to carry on to once the book is finished', () => {
    const book = zh()[0]!;
    const progress: Record<string, ChapterProgress> = {};
    for (const chapter of book.chapters) progress[chapter.id] = { written: chapter.items.map((i) => i.character) };
    expect(nextChapter(book, progress)).toBeUndefined();
  });
});
