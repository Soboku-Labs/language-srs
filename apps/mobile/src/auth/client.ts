import { Platform } from 'react-native';
import { ApiClient } from '@language-srs/client';

/**
 * The API client, and where this app thinks the API lives.
 *
 * The client itself moved to `@language-srs/client` so the web app uses the
 * same one — nine endpoints and a conflict convention are not worth two copies.
 * What stayed is the part that is genuinely about *this* platform: the default
 * base URL.
 */

/**
 * Where the API lives.
 *
 * `EXPO_PUBLIC_API_URL` is inlined into the bundle at build time, so a hosted
 * build points at a hosted API and a local one does not need configuring. The
 * fallback is the port `npm run server` uses — on Android the emulator reaches
 * the host machine through 10.0.2.2 rather than localhost, which is the kind of
 * thing that costs an afternoon if it is not written down somewhere.
 *
 * Empty is treated as unset, not as a base URL. A CI build with the variable
 * declared but not filled in inlines an empty string, which would turn every
 * call into a relative URL against whatever host is serving the app — a 404
 * from the static site, reported to the learner as a broken sign-in.
 */
const CONFIGURED_URL = process.env.EXPO_PUBLIC_API_URL?.trim().replace(/\/+$/, '');

export const API_URL: string =
  CONFIGURED_URL && CONFIGURED_URL.length > 0
    ? CONFIGURED_URL
    : Platform.OS === 'android'
      ? 'http://10.0.2.2:4000'
      : 'http://localhost:4000';

/** This app's client, pointed at the URL resolved above. */
export function createApiClient(): ApiClient {
  return new ApiClient(API_URL);
}

export { ApiClient, ApiRequestError } from '@language-srs/client';
export type { StateConflictResult } from '@language-srs/client';
