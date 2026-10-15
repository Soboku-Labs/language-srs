import { useMemo, useState } from 'react';
import {
  bookFraction,
  chapterFraction,
  getLanguageProfile,
  nextChapter,
  type Book,
  type Chapter,
} from '@language-srs/core';
import { Handwriting } from '../components/Handwriting';
import { Locked } from '../components/Locked';
import { useEngine } from '../providers';
import { useRouter } from '../router';
import { Caption, Rise, Screen, Section, TextButton, Title } from '../ui';

/**
 * The writing app: books, chapters, and a page to write on.
 *
 * A book is a level, a chapter is a page of it, and a page is one character
 * taking as much of the screen as it can get. That is how character workbooks
 * have always been arranged, and it gives handwriting the one thing a review
 * queue cannot — a place you are *up to*, which is still there tomorrow.
 *
 * ## Why this is not the review screen
 *
 * The queue is scheduling: it decides what you see and when, and it is right
 * to. Somebody working through a workbook on an iPad is not asking an
 * algorithm what to write next; they are on chapter three and they want
 * chapter three. So a chapter is a fixed ordered list and progress is a count.
 *
 * The scheduler still owns the `writing` card kind and still brings characters
 * back at the right interval. Two activities, one vocabulary, both worth it.
 *
 * ## Sized for a pen first
 *
 * The pad takes the smaller of the viewport's two dimensions, so on an iPad
 * it is a real writing surface rather than a phone control that has been
 * stretched. A pen's pressure varies the stroke; a finger gets an even line.
 * It works on a phone, which is the point of not building this for one device.
 */

export function Write() {
  const { navigate, path } = useRouter();

  // Three screens, one route family, because they are one activity and the
  // back button should walk back out through them.
  const parts = path.split('/').filter(Boolean);
  const bookId = parts[1] ? decodeURIComponent(parts[1]) : undefined;
  const chapterId = parts[2] ? decodeURIComponent(parts[2]) : undefined;

  return (
    <Screen>
      <Locked feature="writingBooks">
        {bookId && chapterId ? (
          <Page bookId={bookId} chapterId={chapterId} />
        ) : bookId ? (
          <Chapters bookId={bookId} />
        ) : (
          <Shelf onOpen={(book) => navigate(`/write/${encodeURIComponent(book.id)}`)} />
        )}
      </Locked>
    </Screen>
  );
}

/** Every book for the language being studied. */
function Shelf({ onOpen }: { onOpen: (book: Book) => void }) {
  const { engine, revision } = useEngine();
  const code = engine.activeLanguage;
  const books = useMemo(() => engine.getBooks(code), [engine, revision, code]);
  const progress = useMemo(() => engine.getWritingProgress(), [engine, revision]);

  if (books.length === 0) {
    return (
      <Rise index={0}>
        <Caption>
          {getLanguageProfile(code).name} is written in a Latin alphabet, so there is no character
          practice for it — copying a word out is spelling, which the deck already drills.
        </Caption>
      </Rise>
    );
  }

  return (
    <>
      <Rise index={0}>
        <Caption>
          One book per level, a chapter at a time. Your place is kept, and it is kept on your
          account rather than in this browser.
        </Caption>
      </Rise>

      {books.map((book, index) => {
        const done = bookFraction(book, progress);
        const next = nextChapter(book, progress);

        return (
          <Rise key={book.id} index={index + 1}>
            <button type="button" className="book" onClick={() => onOpen(book)}>
              <span className="book__spine" aria-hidden="true" />
              <span className="book__body">
                <span className="book__title">{book.title}</span>
                <span className="book__line">{book.line}</span>
                <span className="track book__track">
                  <span className="track__fill" style={{ ['--fill' as string]: done }} />
                </span>
                <span className="book__meta">
                  {done === 1
                    ? 'Finished'
                    : next
                      ? `Up to chapter ${next.number} of ${book.chapters.length}`
                      : `${book.chapters.length} chapters`}
                </span>
              </span>
            </button>
          </Rise>
        );
      })}
    </>
  );
}

/** The chapters of one book. */
function Chapters({ bookId }: { bookId: string }) {
  const { engine, revision } = useEngine();
  const { navigate } = useRouter();
  const books = useMemo(() => engine.getBooks(), [engine, revision]);
  const progress = useMemo(() => engine.getWritingProgress(), [engine, revision]);

  const book = books.find((candidate) => candidate.id === bookId);
  if (!book) {
    return (
      <Rise index={0}>
        <Caption>That book is not in this language&rsquo;s shelf any more.</Caption>
        <TextButton label="Back to the shelf" onClick={() => navigate('/write')} />
      </Rise>
    );
  }

  return (
    <>
      <Rise index={0}>
        <Title>{book.title}</Title>
        <Caption>{book.line}</Caption>
      </Rise>

      <Rise index={1}>
        <Section>
          {book.chapters.map((chapter) => {
            const done = chapterFraction(chapter, progress[chapter.id]);
            return (
              <button
                key={chapter.id}
                type="button"
                className="chapter"
                onClick={() =>
                  navigate(
                    `/write/${encodeURIComponent(book.id)}/${encodeURIComponent(chapter.id)}`,
                  )
                }
              >
                <span className="chapter__number">{chapter.number}</span>
                <span className="chapter__body">
                  <span className="chapter__title">{chapter.title}</span>
                  <span className="track chapter__track">
                    <span className="track__fill" style={{ ['--fill' as string]: done }} />
                  </span>
                </span>
                <span className="chapter__count">
                  {Math.round(done * chapter.items.length)}/{chapter.items.length}
                </span>
              </button>
            );
          })}
        </Section>
      </Rise>
    </>
  );
}

/** One character, as big as the screen allows. */
function Page({ bookId, chapterId }: { bookId: string; chapterId: string }) {
  const { engine, revision, mutate } = useEngine();
  const { navigate } = useRouter();
  const [at, setAt] = useState(0);
  const [strokes, setStrokes] = useState(0);

  const books = useMemo(() => engine.getBooks(), [engine, revision]);
  const book = books.find((candidate) => candidate.id === bookId);
  const chapter: Chapter | undefined = book?.chapters.find(
    (candidate) => candidate.id === chapterId,
  );

  /*
   * Each character, with the word it came from.
   *
   * The word is context, not the task: 你 on its own is not "hello", so the
   * page shows the gloss of the word with the character picked out of it.
   */
  const items = useMemo(() => {
    const entries = engine.getEntries();
    return (chapter?.items ?? []).map((item) => ({
      character: item.character,
      entry: entries.find((candidate) => candidate.id === item.entryId),
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chapter, engine, revision]);

  if (!book || !chapter || items.length === 0) {
    return (
      <Rise index={0}>
        <Caption>That chapter is not here any more.</Caption>
        <TextButton label="Back to the shelf" onClick={() => navigate('/write')} />
      </Rise>
    );
  }

  const item = items[Math.min(at, items.length - 1)]!;
  const last = at >= items.length - 1;

  /*
   * Marked written on the way out, not on the first stroke.
   *
   * Recording it as soon as the pen touched would tick a character off for a
   * stray mark, and recording it only on a "done" button would make the common
   * case — write it, move on — take two taps instead of one.
   */
  const advance = async () => {
    if (strokes > 0) await mutate((instance) => instance.recordWritten(chapter.id, item.character));
    if (last) navigate(`/write/${encodeURIComponent(book.id)}`);
    else setAt((current) => current + 1);
  };

  return (
    <div className="page">
      <header className="page__head">
        <span className="page__where">
          {chapter.number}.{at + 1} of {items.length}
        </span>
        {/* The word the character came from, with it picked out — so the
            gloss belongs to something, without claiming the character alone
            means it. */}
        <span className="page__gloss">
          {item.entry ? (
            <>
              {[...item.entry.target].map((character, index) => (
                <span
                  key={`${character}-${index}`}
                  className={character === item.character ? 'page__in' : 'page__of'}
                >
                  {character}
                </span>
              ))}
            </>
          ) : (
            item.character
          )}
        </span>
        <span className="page__reading">
          {item.entry ? `${item.entry.reading} · ${item.entry.meanings[0] ?? ''}` : ''}
        </span>
      </header>

      {/*
        The character is shown, not hidden.

        This is a workbook, not a test — the deck already tests recall. What a
        workbook is for is the strokes, in order, with the shape in front of
        you, which is exactly how a child learns to write them.
      */}
      <Handwriting
        size="page"
        label={`Write ${item.character}`}
        reveal={item.character}
        resetKey={item.character}
        onStrokesChange={setStrokes}
      />

      <footer className="page__foot">
        <TextButton
          label="Back"
          muted
          onClick={() => (at === 0 ? navigate(`/write/${encodeURIComponent(book.id)}`) : setAt((c) => c - 1))}
        />
        <TextButton label={last ? 'Finish chapter' : 'Next character'} onClick={() => void advance()} />
      </footer>
    </div>
  );
}
