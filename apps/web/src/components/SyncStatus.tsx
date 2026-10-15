import { useSync } from '../sync';
import { Caption, DetailRow, TextButton } from '../ui';

/**
 * What sync is doing, in terms a learner can act on.
 *
 * The rule the rest of the app follows applies here: no number nobody can act
 * on, and no promise the app cannot keep. So this shows *when* the last sync
 * finished rather than a spinner and a tick — "4 minutes ago" tells somebody
 * whether to worry; "Synced" tells them nothing.
 *
 * A failure is reported as a fact about the network, not as an error the learner
 * caused. Their reviews are on this device either way, which is the part worth
 * saying out loud.
 */

function describeWhen(at: string | undefined): string {
  if (!at) return 'Not yet';

  const minutes = Math.floor((Date.now() - Date.parse(at)) / 60_000);
  if (Number.isNaN(minutes)) return 'Not yet';
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;

  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

export function SyncStatus() {
  const { phase, syncedAt, arrived, message, syncNow } = useSync();

  // A device profile has nothing to sync, and the account section above already
  // says so. A permanently empty row would be worse than silence.
  if (phase === 'off') return null;

  return (
    <>
      <DetailRow label="Last synced" value={describeWhen(syncedAt)} />

      {arrived > 0 ? (
        <Caption>
          {/* The evidence that signing in did something: this many reviews came
              from the learner's other device. */}
          {arrived} review{arrived === 1 ? '' : 's'} arrived from your other devices.
        </Caption>
      ) : null}

      {message ? <Caption>{message}</Caption> : null}

      <TextButton
        label={phase === 'syncing' ? 'Syncing…' : 'Sync now'}
        muted
        disabled={phase === 'syncing'}
        onClick={() => void syncNow()}
      />
    </>
  );
}
