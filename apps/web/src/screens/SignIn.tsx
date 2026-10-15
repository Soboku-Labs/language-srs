import { useState } from 'react';
import { PASSWORD_MIN_LENGTH, type AuthErrorCode } from '@language-srs/core';
import { ApiRequestError } from '@language-srs/client';
import { useAuth, type AuthMode } from '../providers';
import { useRouter } from '../router';
import { BigButton, Caption, Rise, Screen, Section, TextButton, Title } from '../ui';

/**
 * Starting.
 *
 * Two things are true at once and the screen says both: an account carries your
 * progress between devices, and you do not need one. "Use this device" is a
 * first-class choice rather than a greyed-out escape hatch — it gives the whole
 * app, and the only thing given up is the second device.
 *
 * The form appears only when a backend is configured. A password field with
 * nothing behind it is a lie told to whoever types into it, so a build without
 * `VITE_API_URL` offers the device profile and says plainly why that is all
 * there is.
 */

/**
 * The server's codes, in the learner's words.
 *
 * A code rather than the server's message, because the screen decides what to
 * say and where: "that password is wrong" belongs under the password field, and
 * "we could not reach the server" belongs nowhere near it.
 */
const MESSAGES: Partial<Record<AuthErrorCode | 'offline', string>> = {
  invalid_credentials: 'That email and password do not match.',
  email_taken: 'There is already an account with that email.',
  weak_password: `Use at least ${PASSWORD_MIN_LENGTH} characters.`,
  invalid_email: 'That does not look like an email address.',
  offline: 'Could not reach the server. Your progress is safe on this device.',
  rate_limited: 'Too many attempts. Wait a minute and try again.',
  server_error: 'Something went wrong at our end. Try again shortly.',
};

export function SignIn() {
  const { useThisDevice, authenticate, canSignIn } = useAuth();
  const { navigate, query } = useRouter();

  /*
   * Which of the two this is, decided by what was pressed to get here.
   *
   * This screen used to open on "Create an account" however you arrived, so
   * the "Sign in" button in the bar led to a page headed Create an account,
   * with a name field and a Create account button — and the only way to
   * actually sign in was to notice a line of small text underneath. The
   * button was lying about where it went.
   *
   * `?new=1` is set by the things that genuinely mean "make one" — the
   * locked-feature panels. Everything else means sign in, which is also what
   * the route is called.
   */
  const [mode, setMode] = useState<AuthMode>(query.get('new') === '1' ? 'register' : 'signIn');

  /*
   * Where to go afterwards.
   *
   * Somebody who hit a locked feature on /import and made an account was
   * returned to the front door, having to find their way back to the thing
   * they were doing. Only same-site paths are honoured: `from` arrives in a
   * URL, and a URL is something anybody can write.
   */
  const from = query.get('from');
  const back = from && from.startsWith('/') && !from.startsWith('//') ? from : '/';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [busy, setBusy] = useState(false);
  const [waking, setWaking] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const run = (action: () => Promise<void>) => {
    setBusy(true);
    setError(undefined);

    void (async () => {
      try {
        await action();
        navigate(back, { replace: true });
      } catch (cause) {
        setError(
          cause instanceof ApiRequestError
            ? (MESSAGES[cause.code] ?? cause.message)
            : 'Something went wrong. Try again.',
        );
        setBusy(false);
        setWaking(false);
      }
    })();
  };

  const submit = () =>
    run(() =>
      authenticate(
        mode,
        {
          email: email.trim(),
          password,
          ...(mode === 'register' && displayName.trim() ? { displayName: displayName.trim() } : {}),
        },
        // The server sleeps on free hosting and the request that wakes it can
        // take most of a minute. Saying so beats a button that looks stuck.
        () => setWaking(true),
      ),
    );

  const registering = mode === 'register';

  return (
    <Screen>
      <Rise index={0}>
        <div className="stack--tight stack">
          <Title>Mon</Title>
          <Caption>
            Exam-aligned review for Mandarin, Japanese, Korean and Vietnamese.
            {canSignIn ? ' An account carries your progress to your phone. It is not required.' : ''}
          </Caption>
        </div>
      </Rise>

      {canSignIn ? (
        <Rise index={1}>
          <Section title={registering ? 'Create an account' : 'Sign in'}>
            <form
              className="stack"
              onSubmit={(event) => {
                event.preventDefault();
                submit();
              }}
            >
              {registering ? (
                <input
                  className="field"
                  name="displayName"
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                  placeholder="Your name (optional)"
                  autoComplete="name"
                />
              ) : null}
              {/*
                `text`, not `email`.

                The browser's own validation on `type="email"` is not the same
                check as the server's, and two validators disagreeing about
                one field is a field that rejects things the API would accept
                — including the development `admin` login, which is
                deliberately not an address. `inputMode` still asks a phone
                for the email keyboard, and the server decides what is valid,
                which it has to anyway.
              */}
              <input
                className="field"
                type="text"
                inputMode="email"
                /* Named, so a form is a form — and so the browser tests have
                   something to select that does not move when the input's
                   type or autocomplete hint changes, which is exactly what
                   broke them when `type="email"` went. */
                name="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="Email"
                autoComplete="email"
                required
              />
              <input
                className="field"
                type="password"
                name="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Password"
                // Tells a password manager which of the two this is, so it
                // offers to save a new one and fill an existing one.
                autoComplete={registering ? 'new-password' : 'current-password'}
                required
              />
              {error ? <span className="form-error">{error}</span> : null}
              {waking && !error ? <Caption>Waking the server — this can take a moment.</Caption> : null}
              <BigButton
                label={registering ? 'Create account' : 'Sign in'}
                disabled={busy || email.trim().length === 0 || password.length === 0}
                onClick={submit}
              />
            </form>
            <TextButton
              label={registering ? 'I already have an account' : 'Create an account instead'}
              onClick={() => {
                setMode(registering ? 'signIn' : 'register');
                setError(undefined);
              }}
            />
          </Section>
        </Rise>
      ) : null}

      <Rise index={2}>
        <Section {...(canSignIn ? { title: 'Or' } : {})}>
          {/* Not a fallback. For somebody studying on one machine this is the
              correct choice, and the app is complete without an account. */}
          <BigButton
            label="Use this device"
            hint="Everything works offline. Nothing is sent anywhere."
            disabled={busy}
            onClick={() => run(() => useThisDevice())}
          />
          {!canSignIn ? (
            <Caption>
              Carrying progress between devices needs a server, and this build has none configured.
            </Caption>
          ) : null}
        </Section>
      </Rise>
    </Screen>
  );
}
