import React, { useEffect, useRef } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import type { Rating } from '@language-srs/core';
import { useEngine } from '../src/engine/EngineProvider';
import { useTheme, useThemedStyles, type ResolvedTheme } from '../src/theme';

/**
 * The landing route for a widget grade tap.
 *
 * Reached via `languagesrs:///grade?card=...&rating=3` — the fallback path used
 * where a widget cannot grade in its own process: Android widgets, and iOS before
 * interactive widgets. It applies the grading and continues straight into the
 * session, so the tap feels like it was handled by the widget rather than
 * dumping the learner on a dashboard.
 *
 * On iOS 17+ the interactive widget grades through its App Intent and never opens
 * the app, so this route is not involved.
 */
export default function GradeFromWidget() {
  const { engine, grade } = useEngine();
  const theme = useTheme();
  const styles = useThemedStyles(createStyles);
  const router = useRouter();
  const params = useLocalSearchParams<{ card?: string; rating?: string }>();

  // Deep links can re-deliver while this screen is mounted; grade at most once.
  const handled = useRef(false);

  useEffect(() => {
    if (handled.current) return;
    handled.current = true;

    (async () => {
      const cardId = params.card;
      const rating = Number(params.rating) as Rating;
      const isValidRating = Number.isInteger(rating) && rating >= 1 && rating <= 4;

      if (cardId && isValidRating) {
        try {
          await grade(cardId, rating, { source: 'widget' });
        } catch {
          // The card may have been graded in-app since the widget rendered, or
          // removed by a level change. Either way, carry on into the session
          // rather than showing an error for a home-screen tap.
        }
      }

      const remaining = engine.getQueue().cards.length;
      // The dashboard, never the landing page: a widget tap comes from someone
      // who has already chosen a language.
      router.replace(remaining > 0 ? '/review' : '/home');
    })();
  }, [engine, grade, params.card, params.rating, router]);

  return (
    <View style={styles.container}>
      <ActivityIndicator color={theme.colors.accent} />
    </View>
  );
}

const createStyles = (theme: ResolvedTheme) => ({
  container: {
    flex: 1,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    backgroundColor: theme.colors.background,
  },
});
