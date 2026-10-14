import { useSync } from '../sync';
import { Caption, DetailRow, TextButton } from '../ui';

/**
 * What sync is doing, in terms a learner can act on.
 *
 * The rule the rest of the app follows applies here too: no number nobody can
 * act on, and no promise the app cannot keep. So this does not show a spinner
 * and a tick — it shows *when* the last sync finished and *how many* reviews are
 * still waiting, because "4 reviews not yet synced" tells someone to find a
 * connection and "Syncing…" tells them nothing.
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
  const { available, phase, syncedAt, pending, lastError, lastResult, syncNow } = useSync();

  // Nothing to say in a build with no backend. The sign-in screen already
  // explains why there is no sync, and repeating it here as a permanently empty
  // row would be worse than silence.
  if (!available) return null;

  if (phase === 'off') {
    return (
      <Caption>
        Sign in to an account to carry your progress between this browser and your phone.
      </Caption>
    );
  }

  return (
    <>
      <DetailRow label="Last synced" value={describeWhen(syncedAt)} />
      {pending > 0 ? (
        <DetailRow label="Waiting to send" value={`${pending} review${pending === 1 ? '' : 's'}`} />
      ) : null}

      {lastResult && lastResult.merged.reviews > 0 ? (
        <Caption>
          {/* Worth saying, because it is the evidence that signing in did
              something: this many reviews came from the learner's other device. */}
          {lastResult.merged.reviews} review{lastResult.merged.reviews === 1 ? '' : 's'} arrived
          from your other devices.
        </Caption>
      ) : null}

      {lastResult && lastResult.rejected.length > 0 ? (
        <Caption>
          {lastResult.rejected.length} review
          {lastResult.rejected.length === 1 ? '' : 's'} could not be saved — the word was removed
          elsewhere.
        </Caption>
      ) : null}

      {lastError ? (
        <Caption>
          {/* Deliberately not phrased as a failure on the learner's part, and
              deliberately specific about what is safe. */}
          Could not reach the server — your reviews are saved on this device and
          will go up when it is back. ({lastError})
        </Caption>
      ) : null}

      <TextButton
        label={phase === 'syncing' ? 'Syncing…' : 'Sync now'}
        muted
        disabled={phase === 'syncing'}
        onClick={() => void syncNow()}
      />
    </>
  );
}
