import type { ApiErrorBody, AuthErrorCode } from '@language-srs/core';

/**
 * A failure with a status and a code the app can branch on.
 *
 * The message is written to be shown to a learner — the app displays it rather
 * than inventing its own wording, so the rule the server enforces and the
 * sentence the learner reads cannot drift apart. Anything the learner should not
 * see does not go in here; it goes in the log.
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: AuthErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  toBody(): ApiErrorBody {
    return { error: this.code, message: this.message };
  }
}
