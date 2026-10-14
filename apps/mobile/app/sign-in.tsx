import React, { useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { AuthError, type AuthErrorCode } from '@mon/core';
import { useAuth } from '../src/auth/AuthProvider';
import { BigButton, Caption, Screen, Section, TextButton, Title } from '../src/components/ui';
import { Rise } from '../src/motion/components';
import { spacing, typography, useTheme, useThemedStyles, weight, type ResolvedTheme } from '../src/theme';

/**
 * Signing in.
 *
 * Two things are true at once and the screen has to say both: an account is worth
 * having, and you do not need one. So "Continue on this device" is a first-class
 * choice rather than a greyed-out escape hatch at the bottom — a learner who taps
 * it gets the whole app, and the only thing they give up is carrying progress
 * between devices, which is exactly what the line under it says.
 *
 * The email form appears only when a backend is configured. Showing a password
 * field with nothing behind it would be a lie told to whoever typed into it.
 */

/** What each failure means to the person, rather than to the transport. */
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

export default function SignInScreen() {
  const { providers, signIn, register } = useAuth();
  const theme = useTheme();
  const styles = useThemedStyles(createStyles);
  const router = useRouter();

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
      router.replace('/');
    } catch (cause) {
      setError(
        cause instanceof AuthError ? MESSAGES[cause.code] : 'Something went wrong. Try again.',
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <Rise index={0}>
        <View style={styles.header}>
          <Title>Mon</Title>
          <Caption>
            An account carries your progress between your phone and the web. It is not required.
          </Caption>
        </View>
      </Rise>

      {emailProvider ? (
        <Rise index={1}>
          <Section title={registering ? 'Create an account' : 'Sign in'}>
            {registering ? (
              <TextInput
                value={displayName}
                onChangeText={setDisplayName}
                placeholder="Your name"
                placeholderTextColor={theme.colors.inkFaint}
                autoCapitalize="words"
                style={styles.input}
              />
            ) : null}

            <TextInput
              value={email}
              onChangeText={setEmail}
              placeholder="Email"
              placeholderTextColor={theme.colors.inkFaint}
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="email"
              keyboardType="email-address"
              style={styles.input}
            />
            <TextInput
              value={password}
              onChangeText={setPassword}
              placeholder="Password"
              placeholderTextColor={theme.colors.inkFaint}
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete={registering ? 'new-password' : 'current-password'}
              secureTextEntry
              style={styles.input}
              onSubmitEditing={() =>
                void run(() =>
                  registering
                    ? register('email', { email, password, displayName })
                    : signIn('email', { email, password }),
                )
              }
            />

            {error ? <Text style={styles.error}>{error}</Text> : null}

            <BigButton
              label={registering ? 'Create account' : 'Sign in'}
              disabled={busy || email.trim().length === 0 || password.length === 0}
              onPress={() =>
                void run(() =>
                  registering
                    ? register('email', { email, password, displayName })
                    : signIn('email', { email, password }),
                )
              }
            />

            <TextButton
              label={registering ? 'I already have an account' : 'Create an account instead'}
              onPress={() => {
                setRegistering(!registering);
                setError(undefined);
              }}
            />
          </Section>
        </Rise>
      ) : null}

      <Rise index={2}>
        <Section title={emailProvider ? 'Or' : undefined}>
          {/*
            Not a fallback. For someone studying on one phone this is the correct
            choice, and the app is complete without an account.
          */}
          <BigButton
            label="Continue on this device"
            hint="Everything works offline. Nothing is sent anywhere."
            disabled={busy}
            onPress={() => void run(() => signIn('device'))}
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

const createStyles = (theme: ResolvedTheme) => ({
  header: { gap: spacing.sm, paddingTop: spacing.xl, paddingBottom: spacing.lg },
  input: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.control,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md + 2,
    color: theme.colors.ink,
    fontSize: typography.body,
  },
  error: { color: theme.colors.again, fontSize: typography.caption, fontWeight: weight.medium },
});
