import React, { useEffect } from 'react';
import { StyleSheet } from 'react-native';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider, useAuth } from '../src/auth/AuthProvider';
import { EngineProvider } from '../src/engine/EngineProvider';
import { ThemeProvider, useTheme, weight } from '../src/theme';
import { ThemeFade } from '../src/motion/components';

/**
 * Auth wraps the engine, because which account you are decides which slice of
 * storage the engine reads. The engine is rebuilt when that changes.
 */
export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <EngineProvider>
          <ThemeProvider>
            <AccountGate />
            <ThemedNavigator />
          </ThemeProvider>
        </EngineProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}

/**
 * Sends a first-time visitor to the sign-in screen once.
 *
 * A redirect rather than a wall. Every route stays reachable — the deep links a
 * home-screen widget fires are the obvious case, and stranding one of those on a
 * login form would break the widget for someone who simply chose the device
 * profile. This only handles the first launch, when there is no account at all
 * and no meaningful screen to show instead.
 */
function AccountGate() {
  const { isSignedIn } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (isSignedIn) return;
    if (segments[0] === 'sign-in') return;
    router.replace('/sign-in');
  }, [isSignedIn, segments, router]);

  return null;
}

/**
 * The navigator, themed for the active language.
 *
 * Split out because navigation chrome and the status bar both need the theme, and
 * the theme comes from a context established above them. Two of the four themes
 * are light and two are dark, so the status bar style has to follow the theme —
 * dark status bar icons on the Mandarin ink background would be invisible.
 */
function ThemedNavigator() {
  const theme = useTheme();

  return (
    // Switching language changes every colour at once, and in two of the four
    // themes it also flips light to dark. An instant swap reads as a glitch; a
    // short cross-fade reads as the app changing clothes.
    <ThemeFade themeKey={theme.languageCode} style={styles.fill}>
      <StatusBar style={theme.mode === 'dark' ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: theme.colors.canvas },
          headerTintColor: theme.colors.ink,
          // React Navigation only accepts font family, size, weight and colour
          // here, so the theme's letter spacing does not apply to header titles.
          headerTitleStyle: { fontWeight: weight.strong },
          contentStyle: { backgroundColor: theme.colors.canvas },
          headerShadowVisible: false,
        }}
      >
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="review" options={{ title: 'Review' }} />
        <Stack.Screen name="stats" options={{ title: 'Progress' }} />
        <Stack.Screen name="settings" options={{ title: 'Settings' }} />
        <Stack.Screen name="languages" options={{ title: 'Languages' }} />
        <Stack.Screen name="words" options={{ title: 'Words' }} />
        {/* Titled by the word itself once loaded would need the entry here; the
            generic title keeps the header stable while the screen resolves. */}
        <Stack.Screen name="word/[id]" options={{ title: 'Word' }} />
        <Stack.Screen name="sign-in" options={{ headerShown: false }} />
        {/* Entered only from a widget tap; it grades and redirects. */}
        <Stack.Screen name="grade" options={{ headerShown: false, presentation: 'transparentModal' }} />
      </Stack>
    </ThemeFade>
  );
}

const styles = StyleSheet.create({ fill: { flex: 1 } });
