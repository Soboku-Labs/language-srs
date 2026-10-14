import { useMemo, useState } from 'react';
import {
  countByStatus,
  filterDeck,
  sortDeck,
  type DeckSort,
  type DeckStatus,
} from '@mon/core';
import { DeckList } from '../components/DeckList';
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
        <DeckList
          rows={rows}
          onSelect={(entryId) => navigate(`/word/${encodeURIComponent(entryId)}`)}
        />
      )}
    </Screen>
  );
}
