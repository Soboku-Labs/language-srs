import { createConnectTransport } from '@connectrpc/connect-web';

/**
 * The transport, in a module of its own.
 *
 * Both the auth provider and the sync layer need it, and each needs something
 * from the other's module — so putting it in either one makes a cycle. ESM
 * tolerates cycles and then fails at the worst time, when a hoisting order
 * changes under a bundler upgrade.
 */

const API_URL = import.meta.env.VITE_API_URL as string | undefined;

let transport: ReturnType<typeof createConnectTransport> | undefined;

/**
 * The backend, or undefined when this build has none.
 *
 * Built once and reused: it holds a connection pool, and a new one per call
 * would open a new connection per RPC.
 */
export function apiTransport() {
  if (!API_URL) return undefined;
  transport ??= createConnectTransport({
    baseUrl: API_URL,
    /*
     * Binary protobuf, not JSON.
     *
     * Smaller on the wire and quicker to parse, and the browser is indifferent —
     * which is the thing Connect makes possible. A plain JSON API would have no
     * choice, and a raw gRPC one would need a translating proxy in front of it
     * before the browser could speak at all.
     */
    useBinaryFormat: true,
  });
  return transport;
}

/** Whether this build has a backend to sync with. */
export const hasBackend = Boolean(API_URL);
