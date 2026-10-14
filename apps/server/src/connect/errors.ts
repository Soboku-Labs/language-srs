import { Code, ConnectError } from '@connectrpc/connect';
import { AuthError } from '../accounts.ts';
import { HttpError } from '../app.ts';

/**
 * Status codes, translated once.
 *
 * The domain and the account store throw with HTTP statuses because they were
 * written for an HTTP API. Connect has its own code space, and gRPC clients see
 * those codes rather than the status line — a Swift client checking for `409`
 * would be reading a number that never reaches it.
 *
 * Mapping here rather than rewriting the throw sites keeps one behaviour across
 * both surfaces while the JSON routes are still served.
 */
const BY_STATUS: Record<number, Code> = {
  400: Code.InvalidArgument,
  401: Code.Unauthenticated,
  403: Code.PermissionDenied,
  404: Code.NotFound,
  409: Code.AlreadyExists,
  413: Code.ResourceExhausted,
  // Unprocessable: the request parsed and the content was refused — a weak
  // password, not a malformed field.
  422: Code.InvalidArgument,
  429: Code.ResourceExhausted,
};

/**
 * Turn whatever a handler threw into a ConnectError.
 *
 * Anything unrecognised becomes `Internal` with a generic message and is logged
 * in full. A stack trace in a response body is a gift to whoever is probing the
 * service, and the domain's messages are not written for strangers.
 */
export function toConnectError(cause: unknown, route: string): ConnectError {
  if (cause instanceof ConnectError) return cause;

  if (cause instanceof AuthError || cause instanceof HttpError) {
    return new ConnectError(cause.message, BY_STATUS[cause.status] ?? Code.Unknown, undefined, [], cause);
  }

  console.error(`${route} failed`, cause);
  return new ConnectError('Something went wrong.', Code.Internal);
}
