import React from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { EngineProvider } from '../src/engine/EngineProvider';
import { ThemeProvider, useTheme } from '../src/theme';

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
 * Split out because navigation chrome and the status bar both need the theme, and
 * the theme comes from a context established above them. Two of the four themes
 * are light and two are dark, so the status bar style has to follow the theme —
 * dark status bar icons on the Mandarin ink background would be invisible.
 */
function ThemedNavigator() {
  const theme = useTheme();

  return (
    <>
      <StatusBar style={theme.mode === 'dark' ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: theme.colors.background },
          headerTintColor: theme.colors.text,
          // React Navigation only accepts font family, size, weight and colour
          // here, so the theme's letter spacing does not apply to header titles.
          headerTitleStyle: { fontWeight: theme.headingWeight },
          contentStyle: { backgroundColor: theme.colors.background },
          headerShadowVisible: false,
        }}
      >
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="review" options={{ title: 'Review' }} />
        <Stack.Screen name="stats" options={{ title: 'Progress' }} />
        <Stack.Screen name="settings" options={{ title: 'Settings' }} />
        <Stack.Screen name="languages" options={{ title: 'Languages' }} />
        {/* Entered only from a widget tap; it grades and redirects. */}
        <Stack.Screen name="grade" options={{ headerShown: false, presentation: 'transparentModal' }} />
      </Stack>
    </>
  );
}
