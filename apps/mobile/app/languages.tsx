import React, { useMemo } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import {
  LANGUAGE_CODES,
  getExamTracksForLanguage,
  getLanguageProfile,
  getLanguageTheme,
  type LanguageCode,
} from '@language-srs/core';
import { useEngine } from '../src/engine/EngineProvider';
import { Caption, Screen } from '../src/components/ui';
import { spacing, typography, useTheme, useThemedStyles, type ResolvedTheme } from '../src/theme';

/**
 * The language picker.
 *
 * Each row is rendered in that language's *own* theme rather than the active one,
 * so the list shows you what you are choosing. It is the one place in the app that
 * deliberately ignores the current theme — and it replaced a version that
 * described each theme in a paragraph underneath a swatch strip, which said less
 * than simply showing it.
 */
export default function LanguagesScreen() {
  const { engine, revision, setActiveLanguage } = useEngine();
  const theme = useTheme();
  const styles = useThemedStyles(createStyles);
  const router = useRouter();

  const active = engine.activeLanguage;
  const studied = useMemo(() => {
    return new Set(engine.studiedLanguages);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, revision]);

  const choose = async (code: LanguageCode) => {
    await setActiveLanguage(code);
    router.back();
  };

  return (
    <Screen>
      {LANGUAGE_CODES.map((code) => {
        const languageProfile = getLanguageProfile(code);
        const preview = getLanguageTheme(code);
        const tracks = getExamTracksForLanguage(code);
        const isActive = code === active;

        return (
          <Pressable
            key={code}
            onPress={() => void choose(code)}
            style={({ pressed }) => [
              styles.row,
              {
                backgroundColor: preview.colors.surface,
                borderRadius: preview.radius.card,
                borderColor: isActive ? preview.colors.accent : 'transparent',
              },
              pressed && styles.pressed,
            ]}
          >
            <Text style={styles.emoji}>{languageProfile.emoji}</Text>

            <View style={styles.text}>
              <Text
                style={[
                  styles.name,
                  {
                    color: preview.colors.text,
                    fontWeight: preview.headingWeight,
                    letterSpacing: preview.headingLetterSpacing,
                  },
                ]}
              >
                {languageProfile.name}
              </Text>
              <Text style={[styles.meta, { color: preview.colors.textMuted }]}>
                {languageProfile.endonym} · {tracks.map((track) => track.name).join(' / ')}
                {studied.has(code) ? ` · ${engine.getAllCards(code).length} cards` : ''}
              </Text>
            </View>

            {/* A few of that theme's hues, so the row previews itself. */}
            <View style={styles.swatches}>
              {[preview.colors.accent, preview.colors.secondary, preview.colors.good].map((color, index) => (
                <View key={`${color}-${index}`} style={[styles.swatch, { backgroundColor: color }]} />
              ))}
            </View>
          </Pressable>
        );
      })}

      <Caption>
        Switching re-themes the app and its home-screen widget together, and resets nothing — each language keeps its
        own level, exam date and history.
      </Caption>

      <Text style={[styles.footnote, { color: theme.colors.textFaint }]}>
        HSK publishes official word lists, so its targets are exact. JLPT, TOPIK and the Vietnamese framework do not, so
        those coverage figures are estimates and labelled as such.
      </Text>
    </Screen>
  );
}

const createStyles = (_theme: ResolvedTheme) => ({
  row: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: spacing.md,
    padding: spacing.lg,
    borderWidth: 2,
  },
  pressed: { opacity: 0.75 },
  emoji: { fontSize: 30 },
  text: { flex: 1, gap: 2 },
  name: { fontSize: typography.heading },
  meta: { fontSize: typography.micro },
  swatches: { flexDirection: 'row' as const, gap: 3 },
  swatch: { width: 10, height: 26, borderRadius: 5 },
  footnote: { fontSize: typography.micro, lineHeight: 16 },
});
