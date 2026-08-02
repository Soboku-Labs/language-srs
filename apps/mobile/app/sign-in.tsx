import React, { useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { PASSWORD_MIN_LENGTH, validateEmail, validatePassword } from '@language-srs/core';
import { useAuth } from '../src/auth/AuthProvider';
import { API_URL, ApiRequestError } from '../src/auth/client';
import { BigButton, Caption, Screen, TextButton, Title } from '../src/components/ui';
import { Rise } from '../src/motion/components';
import { spacing, typography, useTheme, useThemedStyles, type ResolvedTheme } from '../src/theme';

/**
 * Sign in, or make an account.
 *
 * One screen for both, because they differ by one field and a verb, and two
 * screens would mean a learner who typed their email into the wrong one has to
 * type it again.
 *
 * The rules shown here come from `@language-srs/core` — the same functions the
 * server validates with — so the form cannot promise something the API will
 * refuse. Errors from the server are shown in the server's own words for the
 * same reason.
 */
export default function SignInScreen() {
  const { signIn, register } = useAuth();
  const theme = useTheme();
  const styles = useThemedStyles(createStyles);
  const router = useRouter();

  const [mode, setMode] = useState<'sign-in' | 'register'>('sign-in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | undefined>();
  /** Shown when the API is cold-starting rather than failing. */
  const [waking, setWaking] = useState(false);

  const registering = mode === 'register';

  const submit = async () => {
    if (busy) return;

    // Checked here as well as on the server: a round trip to be told the
    // password is too short is a round trip nobody needed to make.
    const emailProblem = validateEmail(email);
    if (emailProblem) {
      setProblem(emailProblem);
      return;
    }
    if (registering) {
      const passwordProblem = validatePassword(password, email);
      if (passwordProblem) {
        setProblem(passwordProblem);
        return;
      }
    } else if (password.length === 0) {
      setProblem('Enter your password.');
      return;
    }

    setBusy(true);
    setProblem(undefined);
    setWaking(false);

    try {
      const onWaking = () => setWaking(true);
      if (registering) {
        await register({ email, password, ...(displayName.trim() ? { displayName } : {}) }, onWaking);
      } else {
        await signIn({ email, password }, onWaking);
      }
      // Back to wherever the learner was; the tree re-mounts around the new
      // account on its own.
      if (router.canGoBack()) router.back();
      else router.replace('/');
    } catch (error) {
      setProblem(describe(error));
    } finally {
      setBusy(false);
      setWaking(false);
    }
  };

  return (
    <Screen>
      <Rise index={0} style={styles.header}>
        <Title>{registering ? 'Create an account' : 'Sign in'}</Title>
        <Caption>
          {registering
            ? 'An account keeps your schedule, streak and study history in step across every device you use.'
            : 'Your cards, schedule and history come back exactly as you left them.'}
        </Caption>
      </Rise>

      <Rise index={1} style={styles.form}>
        <Field
          label="Email"
          value={email}
          onChangeText={setEmail}
          placeholder="you@example.com"
          keyboardType="email-address"
          autoComplete="email"
          textContentType="emailAddress"
        />

        {registering ? (
          <Field
            label="Name"
            value={displayName}
            onChangeText={setDisplayName}
            placeholder="optional"
            autoComplete="name"
            textContentType="name"
          />
        ) : null}

        <Field
          label="Password"
          value={password}
          onChangeText={setPassword}
          placeholder={registering ? `at least ${PASSWORD_MIN_LENGTH} characters` : ''}
          secureTextEntry
          autoComplete={registering ? 'new-password' : 'current-password'}
          textContentType={registering ? 'newPassword' : 'password'}
          onSubmitEditing={submit}
        />

        {problem ? <Text style={styles.problem}>{problem}</Text> : null}
        {waking ? (
          <Caption>
            Waking the server. It sleeps when nobody has used it for a while, so the first sign-in of the day can take
            up to a minute.
          </Caption>
        ) : null}
      </Rise>

      <Rise index={2}>
        <BigButton
          label={waking ? 'Waking the server…' : busy ? 'One moment…' : registering ? 'Create account' : 'Sign in'}
          onPress={submit}
          disabled={busy}
        />
      </Rise>

      <Rise index={3} style={styles.alternatives}>
        <TextButton
          label={registering ? 'I already have an account' : 'Create an account instead'}
          onPress={() => {
            setMode(registering ? 'sign-in' : 'register');
            setProblem(undefined);
          }}
        />
        <TextButton
          label="Keep studying without an account"
          color={theme.colors.textMuted}
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
        />
      </Rise>

      <Rise index={4}>
        <Caption>
          Studying works signed out; an account only adds syncing between devices. Nothing you study is shared with
          anyone. This app talks to {API_URL}.
        </Caption>
      </Rise>
    </Screen>
  );
}

function Field({
  label,
  ...props
}: { label: string } & React.ComponentProps<typeof TextInput>) {
  const theme = useTheme();
  const styles = useThemedStyles(createStyles);

  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        {...props}
        autoCapitalize="none"
        autoCorrect={false}
        placeholderTextColor={theme.colors.textFaint}
        style={styles.input}
      />
    </View>
  );
}

/**
 * Turn a failure into something worth reading.
 *
 * The server's messages are written for a learner, so they are passed through
 * unchanged. The one case worth rewriting is an unreachable API: "Could not
 * reach the server" tells somebody with no signal nothing they can act on.
 */
function describe(error: unknown): string {
  if (error instanceof ApiRequestError) {
    if (error.code === 'offline') {
      return 'Could not reach the server. Check your connection — you can keep studying without an account meanwhile.';
    }
    return error.message;
  }
  return 'Something went wrong. Try again.';
}

const createStyles = (theme: ResolvedTheme) => ({
  header: { gap: spacing.sm, paddingTop: spacing.lg },
  form: { gap: spacing.lg },
  field: { gap: spacing.xs },
  label: {
    color: theme.colors.textMuted,
    fontSize: typography.micro,
    fontWeight: '700' as const,
    letterSpacing: 1,
    textTransform: 'uppercase' as const,
  },
  input: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.control,
    borderWidth: 1,
    borderColor: theme.colors.border,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    color: theme.colors.text,
    fontSize: typography.body,
  },
  problem: { color: theme.colors.danger, fontSize: typography.caption, lineHeight: 19 },
  alternatives: { alignItems: 'center' as const, gap: spacing.xs },
});
