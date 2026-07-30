import React, { useMemo } from 'react';
import { Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import {
  LANGUAGE_CODES,
  getExamTracksForLanguage,
  getLanguageProfile,
  getLanguageTheme,
  getSeedCounts,
  type LanguageCode,
  type LanguageTheme,
} from '@language-srs/core';
import { useEngine } from '../src/engine/EngineProvider';
import { Body, Caption, Chip, Heading, Panel, Row, Screen } from '../src/components/ui';
import { spacing, typography, useTheme, useThemedStyles, type ResolvedTheme } from '../src/theme';

export default function LanguagesScreen() {
  const { engine, revision, setActiveLanguage } = useEngine();
  const theme = useTheme();
  const styles = useThemedStyles(createStyles);
  const router = useRouter();
  const seedCounts = useMemo(() => getSeedCounts(), []);

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
      <Caption>
        Each language has its own front end — palette, contrast and shape — over the same scheduler and the same review
        history. Switching re-themes the app and its home-screen widget together, and resets nothing.
      </Caption>

      {LANGUAGE_CODES.map((code) => {
        const languageProfile = getLanguageProfile(code);
        const languageTheme = getLanguageTheme(code);
        const tracks = getExamTracksForLanguage(code);
        const isActive = code === active;

        return (
          <Panel
            key={code}
            onPress={() => void choose(code)}
            accent={isActive ? theme.colors.accent : undefined}
          >
            <Row style={styles.header}>
              <View style={styles.headerText}>
                <Heading>
                  {languageProfile.emoji} {languageProfile.name}
                </Heading>
                <Text style={styles.endonym}>{languageProfile.endonym}</Text>
              </View>
              {isActive ? <Chip label="STUDYING" color={theme.colors.success} /> : null}
            </Row>

            <Body muted>{languageProfile.tagline}</Body>

            <ThemePreview theme={languageTheme} />

            <Row style={styles.wrap}>
              {tracks.map((track) => (
                <Chip key={track.id} label={track.name} />
              ))}
              {languageProfile.tonal ? (
                <Chip label={`${languageProfile.toneCount} TONES`} color={theme.colors.warning} />
              ) : null}
            </Row>

            <Caption>
              {seedCounts[code]} words in the starter deck
              {studied.has(code) ? ` · ${engine.getAllCards(code).length} cards created` : ''}
            </Caption>
          </Panel>
        );
      })}

      <Panel>
        <Heading>Where the numbers come from</Heading>
        <Caption>
          HSK publishes official word and character lists, so its coverage targets are exact. The JLPT stopped publishing
          lists in 2010, TOPIK never has, and Vietnam&apos;s MOET framework defines levels by descriptor rather than by
          vocabulary — so those targets are estimates, and the app labels them as such rather than implying a precision
          that does not exist.
        </Caption>
      </Panel>
    </Screen>
  );
}

/**
 * A swatch of the language's own theme.
 *
 * Rendered in that theme's colours rather than the active one, so the picker
 * shows what you are choosing. It is the one place in the app that deliberately
 * ignores the current theme.
 */
function ThemePreview({ theme: preview }: { theme: LanguageTheme }) {
  const styles = useThemedStyles(createStyles);
  const swatches = [
    preview.colors.background,
    preview.colors.surface,
    preview.colors.accent,
    preview.colors.secondary,
    preview.colors.good,
  ];

  return (
    <View style={styles.preview}>
      <View
        style={[
          styles.previewStrip,
          {
            backgroundColor: preview.colors.background,
            borderColor: preview.colors.border,
            borderRadius: preview.radius.card,
          },
        ]}
      >
        {swatches.map((color, index) => (
          <View
            key={`${color}-${index}`}
            style={[styles.swatch, { backgroundColor: color, borderRadius: preview.radius.control }]}
          />
        ))}
        <Text style={[styles.previewLabel, { color: preview.colors.text }]}>{preview.name}</Text>
      </View>
      <Caption>{preview.inspiration}</Caption>
    </View>
  );
}

const createStyles = (theme: ResolvedTheme) => ({
  header: { justifyContent: 'space-between' as const, alignItems: 'flex-start' as const },
  headerText: { flex: 1, gap: 2 },
  endonym: { color: theme.colors.textMuted, fontSize: typography.body },
  wrap: { flexWrap: 'wrap' as const, gap: spacing.sm },
  preview: { gap: spacing.xs },
  previewStrip: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: spacing.xs,
    padding: spacing.sm,
    borderWidth: 1,
  },
  swatch: { width: 18, height: 18 },
  previewLabel: { fontSize: typography.micro, fontWeight: '700' as const, marginLeft: spacing.xs },
});
