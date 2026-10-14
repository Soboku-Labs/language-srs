import { useEffect, useState } from 'react';
import { onWrite } from '../storage';
import { useRouter } from '../router';

/**
 * Telling a learner their reviews are not being saved.
 *
 * This is the one message in the app that interrupts. Everything else waits to
 * be looked at — the sync indicator sits in settings, a card's history sits on
 * its own screen — because nothing else is urgent. This is: every answer given
 * from here on is lost, and the learner cannot tell from anything else on
 * screen, since the queue counts down and the streak ticks up exactly as they
 * would if the writes were landing.
 *
 * It does not offer to fix it, because the app cannot. A full origin is the
 * browser's allowance for this site, and the honest moves are both the
 * learner's: free space by removing words, or take their words with them. So it
 * says what happened in one sentence and points at the export.
 *
 * It cannot be dismissed. A dismissed warning about unsaved work is a worse lie
 * than no warning, and it goes away by itself the moment a write succeeds.
 */
export function StorageWarning() {
  const { path, navigate } = useRouter();
  const [failing, setFailing] = useState(false);

  /*
   * Follows the writes themselves, in both directions: a refused write raises
   * this, and the next one that lands clears it. So a learner who frees space
   * sees it go away on their next answer, and one who has not keeps being told
   * — without the app ever having to guess at the browser's remaining room.
   */
  useEffect(() => onWrite((outcome) => setFailing(!outcome.ok)), []);

  if (!failing) return null;

  return (
    <div className="alert" role="alert">
      <strong className="alert__title">This browser is out of space</strong>
      <span className="alert__body">
        Your most recent answers were not saved and will be lost when you close this tab.
      </span>
      {path === '/import' ? null : (
        <button type="button" className="alert__action" onClick={() => navigate('/import')}>
          Export your words
        </button>
      )}
    </div>
  );
}
