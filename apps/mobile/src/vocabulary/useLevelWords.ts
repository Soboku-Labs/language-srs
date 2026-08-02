import { useEffect, useState } from 'react';
import type { LexicalEntry } from '@language-srs/core';
import { useEngine } from '../engine/EngineProvider';
import { useVocabulary } from './VocabularyProvider';

/**
 * The words of one level, wherever they happen to be.
 *
 * Three sources in order of preference, which is also the order of how much
 * waiting each costs:
 *
 * 1. **The engine**, if the level is in scope. Already in memory, and the only
 *    source whose entries certainly line up with the cards.
 * 2. **The repository**, otherwise — cache first, network second. This is what
 *    makes the all-levels view able to show HSK 5 to somebody working on HSK 2.
 * 3. **Nothing**, said plainly. A level the server does not have is not an
 *    error to shout about; the screen shows the levels it does have.
 *
 * `loading` is true only while there is genuinely nothing to draw. Re-fetching
 * a level that is already on screen would be a spinner over content, which
 * reads as a fault rather than as progress.
 */
export interface LevelWords {
  entries: LexicalEntry[];
  loading: boolean;
  /** The level was asked for and came back with nothing. */
  unavailable: boolean;
}

export function useLevelWords(levelId: string | undefined): LevelWords {
  const { engine, revision } = useEngine();
  const { loadLevel } = useVocabulary();

  const [state, setState] = useState<LevelWords>({ entries: [], loading: Boolean(levelId), unavailable: false });

  useEffect(() => {
    if (!levelId) {
      setState({ entries: [], loading: false, unavailable: false });
      return;
    }

    let cancelled = false;

    const known = [...engine.entries.values()].filter((entry) => entry.levelIds.includes(levelId));
    if (known.length > 0) {
      setState({ entries: known, loading: false, unavailable: false });
      return;
    }

    setState({ entries: [], loading: true, unavailable: false });
    void loadLevel(levelId).then((entries) => {
      if (cancelled) return;
      setState({ entries, loading: false, unavailable: entries.length === 0 });
    });

    return () => {
      cancelled = true;
    };
    // `revision` is in here because the engine's entries change when a level
    // finishes downloading, which is exactly when this should look again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [levelId, engine, revision, loadLevel]);

  return state;
}
