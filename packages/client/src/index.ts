/**
 * @language-srs/client — the app's side of the account API.
 *
 * Shared by the web app and the phone. It holds no study logic: the scheduler
 * lives in `@language-srs/core`, and this is only how a device talks to the
 * server about an account.
 */
export { ApiClient, ApiRequestError, WAKE_TIMEOUT_MS } from './client';
export type { StateConflictResult } from './client';

// Merging two devices' state, which is a domain question rather than a
// transport one and therefore lives in the core.
export { mergeStateValues } from '@language-srs/core';
export type { StateMergeResult } from '@language-srs/core';
