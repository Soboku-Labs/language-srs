import type { IncomingMessage } from 'node:http';
import { ApiError } from './errors.ts';

/**
 * A router, in sixty lines.
 *
 * Express would do this and a great deal more; the great deal more is the
 * problem. This service has ten routes and one middleware concern, and a
 * dependency that ships its own body parser, its own error semantics and a
 * decade of middleware conventions is a larger thing to keep current than the
 * matching logic it replaces. The rest of the repo has no runtime dependencies
 * either — this is the same decision.
 *
 * Patterns are literal segments and `:name` captures. No wildcards, no regular
 * expressions, no optional segments: everything this API needs, and nothing that
 * needs a manual.
 */
export interface RouteContext {
  request: IncomingMessage;
  params: Record<string, string>;
  query: URLSearchParams;
  /** Parsed JSON body, or undefined for bodyless methods. */
  body: unknown;
}

export interface RouteResult {
  status: number;
  body?: unknown;
  /**
   * How long this response may be kept.
   *
   * Everything about an account is `no-store`, and that is the default. Only the
   * published word lists opt out: they are public, identical for everybody, and
   * change when a commit lands rather than while somebody is studying.
   */
  cache?: 'immutable' | 'short';
  /** Strong validator, so a repeat request costs a 304 rather than the payload. */
  etag?: string;
}

export type RouteHandler = (context: RouteContext) => Promise<RouteResult>;

interface Route {
  method: string;
  segments: string[];
  handler: RouteHandler;
}

export class Router {
  private readonly routes: Route[] = [];

  add(method: string, pattern: string, handler: RouteHandler): this {
    this.routes.push({
      method: method.toUpperCase(),
      segments: splitPath(pattern),
      handler,
    });
    return this;
  }

  get = (pattern: string, handler: RouteHandler) => this.add('GET', pattern, handler);
  post = (pattern: string, handler: RouteHandler) => this.add('POST', pattern, handler);
  put = (pattern: string, handler: RouteHandler) => this.add('PUT', pattern, handler);
  delete = (pattern: string, handler: RouteHandler) => this.add('DELETE', pattern, handler);

  /**
   * Find the handler for a request.
   *
   * A path that matches under a different method produces 405 rather than 404,
   * because "you used the wrong verb" and "there is nothing here" are different
   * problems and only one of them is the caller's typo.
   */
  match(method: string, path: string): { handler: RouteHandler; params: Record<string, string> } | 'method-not-allowed' | undefined {
    const segments = splitPath(path);
    let pathMatched = false;

    for (const route of this.routes) {
      const params = matchSegments(route.segments, segments);
      if (!params) continue;
      pathMatched = true;
      if (route.method === method.toUpperCase()) return { handler: route.handler, params };
    }

    return pathMatched ? 'method-not-allowed' : undefined;
  }
}

function splitPath(path: string): string[] {
  return path.split('/').filter((segment) => segment.length > 0);
}

function matchSegments(pattern: string[], actual: string[]): Record<string, string> | undefined {
  if (pattern.length !== actual.length) return undefined;

  const params: Record<string, string> = {};
  for (const [index, segment] of pattern.entries()) {
    const value = actual[index]!;
    if (segment.startsWith(':')) {
      params[segment.slice(1)] = decodeURIComponent(value);
      continue;
    }
    if (segment !== value) return undefined;
  }
  return params;
}

/**
 * Read and parse a JSON body.
 *
 * The size limit is enforced while reading rather than after: a limit checked
 * once the body is in memory is not a limit, it is a report of how much memory
 * somebody just made you allocate.
 *
 * Written with listeners rather than `for await`, and the difference is not
 * style. Abandoning an async iteration over a request destroys the stream, which
 * takes the socket with it — so the caller writes a considered 413 into a
 * connection that is already gone and the client sees only "other side closed".
 * Here the stream is merely paused, leaving the socket alive long enough to say
 * what went wrong, which is the entire point of having a status code for it.
 */
export function readJsonBody(request: IncomingMessage, limitBytes: number): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;

    const cleanup = () => {
      request.off('data', onData);
      request.off('end', onEnd);
      request.off('error', onError);
    };

    const onData = (chunk: Buffer) => {
      total += chunk.length;
      if (total > limitBytes) {
        cleanup();
        request.pause();
        reject(new ApiError(413, 'payload_too_large', 'That is larger than this server accepts.'));
        return;
      }
      chunks.push(chunk);
    };

    const onEnd = () => {
      cleanup();
      if (total === 0) {
        resolve(undefined);
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new ApiError(400, 'bad_request', 'That request body is not valid JSON.'));
      }
    };

    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };

    request.on('data', onData);
    request.on('end', onEnd);
    request.on('error', onError);
  });
}
