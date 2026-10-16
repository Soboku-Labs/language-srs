import { useState } from 'react';
import { PASSWORD_MIN_LENGTH, type AuthErrorCode } from '@language-srs/core';
import { ApiRequestError } from '@language-srs/client';
import { useAuth, type AuthMode } from '../providers';
import { useRouter } from '../router';
import { BigButton, Caption, Rise, Screen, Section, TextButton, Title } from '../ui';
import { Logo } from '../components/Logo';

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
  const { useThisDevice, useDemo, authenticate, canSignIn } = useAuth();
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
  const [preparingDemo, setPreparingDemo] = useState(false);
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
        setPreparingDemo(false);
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
      {/*
        The one page where the mark belongs.

        Everywhere else the product's name is a small thing in the corner,
        because the learner is here to study rather than to admire a logo. A
        page asking for an email is the exception: it is the page where
        somebody decides whether they trust this with their study history, and
        a bare "Mon" in body text is not much to go on.
      */}
      <Rise index={0}>
        <div className="signin__head">
          <Logo size={34} title="Mon" />
          <Title>{registering ? 'Create your account' : 'Welcome back'}</Title>
          <Caption>
            {canSignIn
              ? registering
                ? 'An email and a password. No card, and nothing else asked for.'
                : 'Your deck, its schedule and your whole history, wherever you left them.'
              : 'Exam-aligned review for Mandarin, Japanese, Korean and Vietnamese.'}
          </Caption>
        </div>
      </Rise>

      {/*
        Said properly, not as a footnote.

        This build has no API, so there is no account to make — and the page
        was saying so in one line of small grey text under a button, which
        reads as a page that is broken rather than a build that is configured
        a particular way. It is the main thing on the screen when it is true,
        because it is the answer to the question somebody came here with.
      */}
      {!canSignIn ? (
        <Rise index={1}>
          <div className="notice">
            <span className="notice__title">No account on this build</span>
            <Caption>
              Accounts need a server, and this one is published without an API. Everything else
              works: the whole deck, every exercise, the writing books and your progress, kept in
              this browser.
            </Caption>
            <Caption>
              Carrying progress to a second device is the only thing an account adds, and it is
              the only thing missing here.
            </Caption>
          </div>
        </Rise>
      ) : null}

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
        <Section {...(canSignIn ? { title: 'Not sure yet?' } : {})}>
          {/* Not a fallback. For somebody studying on one machine this is the
              correct choice, and the app is complete without an account. */}
          {/*
            Outlined when there is a sign-in form above it.

            It is a first-class choice and the app is complete without an
            account — but on a page headed "Welcome back" it is the second
            thing, and a filled black block at the bottom was out-shouting the
            Sign in button it sits under. Where there is no form it is the
            only action on the page, so it is filled again.
          */}
          {/*
            Only where there is no server to make an account on.

            Studying needs an account now, so offering "use this device"
            beside the form would be offering a way past the requirement —
            and the person who took it would hit the sign-in page again on the
            next screen. Where there is no API it is the only way in, so it is
            the only button.
          */}
          {!canSignIn ? (
            <BigButton
              label="Use this device"
              hint="Everything works offline. Nothing is sent anywhere."
              disabled={busy}
              onClick={() => run(() => useThisDevice())}
            />
          ) : null}


          {/*
            A look around, for the things an account unlocks that cannot be
            described — a second language, importing a word list, the writing
            books. Asking somebody to make an account to find out whether they
            want one is the wrong way round.

            Not a credential: nothing is registered and there is no demo user
            on any server. It is this browser showing the whole UI, in its own
            storage slice, saying so throughout.
          */}
          <TextButton
            label={preparingDemo ? 'Setting up the demo\u2026' : 'Look around with a demo first'}
            muted
            disabled={busy}
            onClick={() => {
              // It builds a fortnight of real review history, which takes a
              // second or two of writes. A button that looks stuck for that
              // long is worse than one that says what it is doing.
              setPreparingDemo(true);
              run(() => useDemo());
            }}
          />
        </Section>
      </Rise>
    </Screen>
  );
}
