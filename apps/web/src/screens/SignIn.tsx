import { useState } from 'react';
import { useAuth } from '../providers';
import { useRouter } from '../router';
import { BigButton, Caption, Rise, Screen, Section, Title } from '../ui';

/**
 * Starting.
 *
 * Two things are true at once and the screen says both: a name is worth having,
 * and nothing is being sent anywhere. "Continue on this device" is a
 * first-class choice rather than a greyed-out escape hatch — it gives the whole
 * app, and the only thing given up is carrying progress between devices.
 *
 * There is no password field, deliberately. The backend has accounts, but this
 * app has no client for them yet, and a form with nothing behind it is a lie
 * told to whoever types into it. When the API contract lands this screen grows
 * an email form beside the button and nothing else here changes.
 */
export function SignIn() {
  const { signIn } = useAuth();
  const { navigate } = useRouter();

  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const start = () => {
    setBusy(true);
    setError(undefined);

    void (async () => {
      try {
        await signIn(name);
        navigate('/', { replace: true });
      } catch {
        // The only way this fails is storage being blocked, which is worth
        // naming precisely: it is not the learner's name that was wrong.
        setError('This browser is blocking storage, so progress cannot be saved here.');
        setBusy(false);
      }
    })();
  };

  return (
    <Screen>
      <Rise index={0}>
        <div className="stack--tight stack">
          <Title>Mon</Title>
          <Caption>
            Exam-aligned review for Mandarin, Japanese, Korean and Vietnamese. Pick a name so the
            app can tell you apart from anyone else using this browser.
          </Caption>
        </div>
      </Rise>

      <Rise index={1}>
        <Section>
          <form
            className="stack"
            onSubmit={(event) => {
              event.preventDefault();
              start();
            }}
          >
            <input
              className="field"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Your name (optional)"
              autoComplete="name"
            />
            {error ? <span className="form-error">{error}</span> : null}
            <BigButton
              label="Continue on this device"
              hint="Everything works offline. Nothing is sent anywhere."
              disabled={busy}
              onClick={start}
            />
          </form>
          <Caption>
            Carrying progress between your laptop and your phone needs an account on the server,
            which this build cannot do yet.
          </Caption>
        </Section>
      </Rise>
    </Screen>
  );
}
