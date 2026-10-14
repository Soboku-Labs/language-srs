import { ApiClient } from '@language-srs/client';

/**
 * Where the API lives, from a browser.
 *
 * `VITE_API_URL` is inlined at build time, so a hosted build points at a hosted
 * API and a local one does not need configuring.
 *
 * Empty is treated as unset rather than as a base URL. A CI build with the
 * variable declared but not filled in inlines an empty string, which would turn
 * every call into a relative URL against whatever host is serving the app — a
 * 404 from the static site, reported to the learner as a broken sign-in.
 *
 * With no URL at all there is no account offered. That is the honest state for
 * the Pages build: the app works completely, on one device, and the sign-in
 * screen says so rather than showing a password field with nothing behind it.
 */
const CONFIGURED = (import.meta.env.VITE_API_URL as string | undefined)?.trim().replace(/\/+$/, '');

export const API_URL: string | undefined = CONFIGURED && CONFIGURED.length > 0 ? CONFIGURED : undefined;

/** Whether this build has a backend to carry progress between devices. */
export const hasBackend = Boolean(API_URL);

let client: ApiClient | undefined;

/**
 * The client, built once.
 *
 * Shared with the phone — `@language-srs/client` — so the two apps cannot drift
 * about what the endpoints are or what a conflict means.
 */
export function api(): ApiClient {
  if (!API_URL) throw new Error('No API configured for this build.');
  client ??= new ApiClient(API_URL);
  return client;
}

/**
 * What this device calls itself in the account's session list.
 *
 * Shown to the learner when they revoke a session, so it should name something
 * they can recognise — "Chrome on macOS" tells you which machine to sign out;
 * a random id does not.
 */
export function deviceName(): string {
  if (typeof navigator === 'undefined') return 'Browser';

  const agent = navigator.userAgent;
  const browser =
    /Edg\//.test(agent) ? 'Edge'
    : /OPR\//.test(agent) ? 'Opera'
    : /Chrome\//.test(agent) ? 'Chrome'
    : /Safari\//.test(agent) ? 'Safari'
    : /Firefox\//.test(agent) ? 'Firefox'
    : 'Browser';

  const platform =
    /Mac OS X/.test(agent) ? 'macOS'
    : /Windows/.test(agent) ? 'Windows'
    : /Android/.test(agent) ? 'Android'
    : /iPhone|iPad/.test(agent) ? 'iOS'
    : /Linux/.test(agent) ? 'Linux'
    : undefined;

  return platform ? `${browser} on ${platform}` : browser;
}
