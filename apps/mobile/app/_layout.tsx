import React from 'react';
import { StyleSheet } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { EngineProvider } from '../src/engine/EngineProvider';
import { ThemeProvider, useTheme } from '../src/theme';
import { ThemeFade } from '../src/motion/components';

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <EngineProvider>
        <ThemeProvider>
          <ThemedNavigator />
        </ThemeProvider>
      </EngineProvider>
    </SafeAreaProvider>
  );
}

/**
 * The navigator, themed for the active language.
 *
 * The four themes now share one ground and differ only in their accent, so the
 * chrome barely moves when the language changes — but it still reads from the
 * theme rather than hard-coding a colour, because the accent is what tints the
 * back button and the header title.
 *
 * `index` is the landing page and the app always opens on it; the dashboard is
 * `home`, one push deeper. Ordering here is the navigation stack, so a learner
 * who taps into a language and presses back lands at the front door rather than
 * on a blank screen.
 */
function ThemedNavigator() {
  const theme = useTheme();

  return (
    <ThemeFade themeKey={theme.languageCode} style={styles.fill}>
      <StatusBar style={theme.mode === 'dark' ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: theme.colors.background },
          headerTintColor: theme.colors.accent,
          // React Navigation only accepts font family, size, weight and colour
          // here, so the theme's letter spacing does not apply to header titles.
          headerTitleStyle: { fontWeight: theme.headingWeight, color: theme.colors.text },
          contentStyle: { backgroundColor: theme.colors.background },
          headerShadowVisible: false,
          headerBackButtonDisplayMode: 'minimal',
        }}
      >
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="home" options={{ headerShown: false }} />
        <Stack.Screen name="review" options={{ title: 'Review' }} />
        <Stack.Screen name="stats" options={{ title: 'Progress' }} />
        <Stack.Screen name="settings" options={{ title: 'Settings' }} />
        {/* Entered only from a widget tap; it grades and redirects. */}
        <Stack.Screen name="grade" options={{ headerShown: false, presentation: 'transparentModal' }} />
      </Stack>
    </ThemeFade>
  );
}

const styles = StyleSheet.create({ fill: { flex: 1 } });
