import { useState } from 'react';
import { AuthError, type AuthErrorCode } from '@mon/core';
import { useAuth } from '../providers';
import { useRouter } from '../router';
import { BigButton, Caption, Rise, Screen, Section, TextButton, Title } from '../ui';

/**
 * Signing in.
 *
 * Two things are true at once and the screen says both: an account is worth
 * having, and you do not need one. "Continue on this device" is a first-class
 * choice rather than a greyed-out escape hatch — tapping it gives the whole app,
 * and the only thing given up is carrying progress between devices.
 *
 * The email form appears only when a backend is configured. A password field
 * with nothing behind it is a lie told to whoever types into it.
 */
const MESSAGES: Record<AuthErrorCode, string> = {
  'invalid-credentials': 'That email and password do not match.',
  'email-taken': 'There is already an account with that email.',
  'weak-password': 'Use at least 8 characters.',
  'invalid-email': 'That does not look like an email address.',
  'not-configured': 'Email sign-in is not available in this build.',
  network: 'Could not reach the server. Your progress is safe on this device.',
  server: 'Something went wrong at our end. Try again shortly.',
  expired: 'That session has expired. Sign in again.',
};

export function SignIn() {
  const { providers, signIn, register } = useAuth();
  const { navigate } = useRouter();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [registering, setRegistering] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const emailProvider = providers.find((provider) => provider.id === 'email');

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(undefined);
    try {
      await action();
      navigate('/', { replace: true });
    } catch (cause) {
      setError(cause instanceof AuthError ? MESSAGES[cause.code] : 'Something went wrong. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const submit = () =>
    void run(() =>
      registering
        ? register('email', { email, password, displayName })
        : signIn('email', { email, password }),
    );

  return (
    <Screen>
      <Rise index={0}>
        <div className="stack--tight stack">
          <Title>Mon</Title>
          <Caption>
            An account carries your progress between your phone and the web. It is not required.
          </Caption>
        </div>
      </Rise>

      {emailProvider ? (
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
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                  placeholder="Your name"
                  autoComplete="name"
                />
              ) : null}
              <input
                className="field"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="Email"
                autoComplete="email"
              />
              <input
                className="field"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Password"
                autoComplete={registering ? 'new-password' : 'current-password'}
              />
              {error ? <span className="form-error">{error}</span> : null}
              <BigButton
                label={registering ? 'Create account' : 'Sign in'}
                disabled={busy || email.trim().length === 0 || password.length === 0}
                onClick={submit}
              />
            </form>
            <TextButton
              label={registering ? 'I already have an account' : 'Create an account instead'}
              onClick={() => {
                setRegistering(!registering);
                setError(undefined);
              }}
            />
          </Section>
        </Rise>
      ) : null}

      <Rise index={2}>
        <Section {...(emailProvider ? { title: 'Or' } : {})}>
          {/* Not a fallback. For someone studying on one machine this is the
              correct choice, and the app is complete without an account. */}
          <BigButton
            label="Continue on this device"
            hint="Everything works offline. Nothing is sent anywhere."
            disabled={busy}
            onClick={() => void run(() => signIn('device'))}
          />
          {!emailProvider ? (
            <Caption>
              Syncing across devices needs a server, and this build has none configured yet.
            </Caption>
          ) : null}
        </Section>
      </Rise>
    </Screen>
  );
}
