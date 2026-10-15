import { useWindowVirtualizer } from '@tanstack/react-virtual';
import type { DeckEntry } from '@language-srs/core';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';

/**
 * The deck list, windowed above a threshold.
 *
 * ## Why this exists, with the numbers
 *
 * The screen renders one row per word and the app's own curriculum goes to
 * HSK 7–9, which is about eleven thousand of them. Measured in Chromium, tapping
 * "Words" and waiting for the list to paint:
 *
 * | words  | rows   | DOM nodes | time to paint |
 * | ------ | ------ | --------- | ------------- |
 * | 2,500  | 2,532  | 15,192    | 147ms         |
 * | 5,000  | 5,032  | 30,192    | 399ms         |
 * | 11,000 | 11,032 | 66,192    | **1,222ms**   |
 *
 * Worse than linear, and 1.2 seconds is a freeze rather than a delay. Scrolling
 * was never the problem — 15,000 static nodes scroll at a steady 17ms frame with
 * nothing dropped — so this is about the render, which is why windowing fixes it
 * and nothing else here would.
 *
 * ## Why there are two paths
 *
 * A windowed list breaks tab order: you cannot Tab to a row that is not in the
 * DOM. At eleven thousand rows tabbing was never a usable way to reach anything
 * and search is the real affordance, so the trade is clearly worth it. At
 * twenty-seven — the seed deck, which is what most people have — it buys a few
 * milliseconds and costs keyboard access, which is a bad trade.
 *
 * So small decks render as a plain list and large ones are windowed. Both use
 * the same row, so the only thing that differs is the container.
 */

/**
 * Where plain DOM stops being the better choice.
 *
 * Set above a typical level import's visible page and below the point where the
 * render cost is felt: 150 rows paints in single-digit milliseconds, and a list
 * that long is already being searched rather than scrolled through.
 */
const WINDOW_THRESHOLD = 150;

/** Row height in pixels, for the initial estimate before anything is measured. */
const ESTIMATED_ROW = 68;

export interface DeckListProps {
  rows: DeckEntry[];
  onSelect(entryId: string): void;
}

export function DeckList({ rows, onSelect }: DeckListProps) {
  if (rows.length <= WINDOW_THRESHOLD) {
    return (
      <ul className="deck">
        {rows.map((row) => (
          <li key={row.entry.id}>
            <WordRow row={row} onClick={() => onSelect(row.entry.id)} />
          </li>
        ))}
      </ul>
    );
  }

  return <WindowedDeck rows={rows} onSelect={onSelect} />;
}

function WindowedDeck({ rows, onSelect }: DeckListProps) {
  const listRef = useRef<HTMLDivElement>(null);
  /*
   * Where the list starts down the page.
   *
   * The window is the scroll container — deliberately, so the page keeps one
   * scrollbar and the list does not become a box that scrolls inside a page that
   * also scrolls. The virtualizer therefore has to know how far down the
   * document the list begins, or it renders the wrong window of rows.
   */
  const [offset, setOffset] = useState(0);

  useLayoutEffect(() => {
    const measure = () => {
      const top = listRef.current?.getBoundingClientRect().top;
      if (top !== undefined) setOffset(top + window.scrollY);
    };

    measure();
    // The filter chips above the list change height when the search box shows a
    // result count, which moves the list without the list re-rendering.
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [rows.length]);

  const virtualizer = useWindowVirtualizer({
    count: rows.length,
    estimateSize: () => ESTIMATED_ROW,
    // Rows wrap to two lines when a word has several meanings, so the estimate is
    // replaced by a real measurement as each row mounts.
    overscan: 8,
    scrollMargin: offset,
  });

  const items = virtualizer.getVirtualItems();

  // Returning to the top when the filter changes, because row 4,000 of the old
  // list is a meaningless position in the new one.
  useEffect(() => {
    virtualizer.scrollToIndex(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally on the row set, not the virtualizer
  }, [rows]);

  return (
    <div ref={listRef}>
      <div
        className="deck"
        role="list"
        style={{ height: virtualizer.getTotalSize(), position: 'relative' }}
      >
        {items.map((item) => (
          <div
            key={rows[item.index]!.entry.id}
            role="listitem"
            data-index={item.index}
            ref={virtualizer.measureElement}
            className="deck__window-row"
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              transform: `translateY(${item.start - virtualizer.options.scrollMargin}px)`,
            }}
          >
            <WordRow row={rows[item.index]!} onClick={() => onSelect(rows[item.index]!.entry.id)} />
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * One word.
 *
 * The strength bar is the weakest of the word's cards rather than their mean: a
 * word whose meaning is solid and whose tones are gone is not half-known, it is
 * a word you will get wrong. A word with nothing studied gets no bar at all —
 * an empty track on every row of a fresh deck is "no data" said thirty times.
 */
export function WordRow({ row, onClick }: { row: DeckEntry; onClick: () => void }) {
  return (
    <button type="button" className="deck__row" onClick={onClick}>
      <span className="deck__text">
        <span className="deck__target">{row.entry.target}</span>
        <span className="deck__meaning">
          {row.entry.reading} · {row.entry.meanings.join(', ')}
        </span>
      </span>
      <span className="deck__right">
        {row.dueNow > 0 ? <span className="deck__due">{row.dueNow} due</span> : null}
        {row.weakest !== undefined ? (
          <span className="track deck__track">
            <span
              className="track__fill"
              style={{
                ['--fill' as string]: Math.max(0.02, row.weakest),
                ...(row.status === 'suspended' ? { background: 'var(--ink-faint)' } : {}),
              }}
            />
          </span>
        ) : null}
      </span>
    </button>
  );
}
