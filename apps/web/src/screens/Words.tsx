import { useMemo, useState } from 'react';
import {
  countByStatus,
  filterDeck,
  sortDeck,
  type DeckEntry,
  type DeckSort,
  type DeckStatus,
} from '@mon/core';
import { useEngine } from '../providers';
import { useRouter } from '../router';
import { Caption, Choice, Rise, Row, Screen } from '../ui';

/**
 * The deck.
 *
 * One row is one word, not one card. Nobody wants to know that a word's
 * listening card is due Thursday; they want to know whether they know the word.
 */

const STATUS_LABELS: Record<DeckStatus, string> = {
  new: 'Unseen',
  learning: 'Learning',
  review: 'Known',
  suspended: 'Paused',
};

const SORT_LABELS: Record<DeckSort, string> = {
  level: 'Level',
  weakest: 'Weakest',
  due: 'Next due',
  alphabetical: 'A–Z',
};

export function Words() {
  const { engine, revision } = useEngine();
  const { navigate } = useRouter();

  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<DeckStatus | undefined>();
  const [sort, setSort] = useState<DeckSort>('level');

  const deck = useMemo(() => engine.getDeck(), [engine, revision]);
  const counts = useMemo(() => countByStatus(deck), [deck]);
  const rows = useMemo(
    () =>
      sortDeck(
        filterDeck(deck, { ...(query ? { query } : {}), ...(status ? { status } : {}) }),
        sort,
      ),
    [deck, query, status, sort],
  );

  return (
    <Screen>
      <Rise index={0}>
        <div className="stack">
          <input
            className="field"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search words, readings, meanings"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            aria-label="Search the deck"
          />

          <Row wrap>
            <Choice label={`All ${deck.length}`} selected={status === undefined} onClick={() => setStatus(undefined)} />
            {(['learning', 'review', 'new', 'suspended'] as DeckStatus[])
              .filter((candidate) => counts[candidate] > 0)
              .map((candidate) => (
                <Choice
                  key={candidate}
                  label={`${STATUS_LABELS[candidate]} ${counts[candidate]}`}
                  selected={status === candidate}
                  onClick={() => setStatus(status === candidate ? undefined : candidate)}
                />
              ))}
          </Row>

          <Row wrap>
            {(Object.keys(SORT_LABELS) as DeckSort[]).map((candidate) => (
              <button
                key={candidate}
                type="button"
                className={`sort${sort === candidate ? ' sort--active' : ''}`}
                onClick={() => setSort(candidate)}
                aria-pressed={sort === candidate}
              >
                {SORT_LABELS[candidate]}
              </button>
            ))}
          </Row>
        </div>
      </Rise>

      {rows.length === 0 ? (
        <Caption>{query ? `Nothing matches “${query}”.` : 'No words here yet.'}</Caption>
      ) : (
        <ul className="deck">
          {rows.map((row) => (
            <WordRow
              key={row.entry.id}
              row={row}
              onClick={() => navigate(`/word/${encodeURIComponent(row.entry.id)}`)}
            />
          ))}
        </ul>
      )}
    </Screen>
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
function WordRow({ row, onClick }: { row: DeckEntry; onClick: () => void }) {
  return (
    <li>
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
                  width: `${Math.max(2, Math.round(row.weakest * 100))}%`,
                  ...(row.status === 'suspended' ? { background: 'var(--ink-faint)' } : {}),
                }}
              />
            </span>
          ) : null}
        </span>
      </button>
    </li>
  );
}
