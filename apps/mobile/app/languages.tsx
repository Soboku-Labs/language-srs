import React, { useMemo } from 'react';
import { Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import {
  LANGUAGE_CODES,
  getExamTracksForLanguage,
  getLanguageProfile,
  getLanguageTheme,
  resolvePalette,
  type LanguageCode,
} from '@language-srs/core';
import { useEngine } from '../src/engine/EngineProvider';
import { Caption, Screen } from '../src/components/ui';
import { Press, Rise } from '../src/motion/components';
import { spacing, typography, useTheme, useThemedStyles, weight, type ResolvedTheme } from '../src/theme';

/**
 * The language picker.
 *
 * Previously each row rendered in that language's *own* full theme, so the list
 * doubled as a preview of four different-looking apps. There is only one app now,
 * and the whole of a language's visual identity is a single accent — so the row is
 * a name and a dot of that accent, which is the honest amount of preview.
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
      {LANGUAGE_CODES.map((code, index) => {
        const profile = getLanguageProfile(code);
        // The accent shown is the one this language would use in the current
        // appearance, so the dot matches what you get if you tap it.
        const accent = resolvePalette(code, theme.mode).accent;
        const accentName = getLanguageTheme(code).accentName;
        const tracks = getExamTracksForLanguage(code);
        const isActive = code === active;

        return (
          <Rise key={code} index={index}>
            <Press onPress={() => void choose(code)} style={styles.row}>
              <View style={[styles.dot, { backgroundColor: accent }]} />

              <View style={styles.text}>
                <Text style={styles.name}>{profile.name}</Text>
                <Text style={styles.meta}>
                  {profile.endonym} · {tracks.map((track) => track.name).join(' / ')}
                  {studied.has(code) ? ` · ${engine.getAllCards(code).length} cards` : ''}
                </Text>
              </View>

              <Text style={[styles.trailing, isActive && { color: accent }]}>
                {isActive ? 'Studying' : accentName}
              </Text>
            </Press>
          </Rise>
        );
      })}

      <Caption>
        Switching changes the accent and nothing else, and resets nothing — each language keeps its own level, exam date
        and history.
      </Caption>

      <Text style={styles.footnote}>
        HSK publishes official word lists, so its targets are exact. JLPT, TOPIK and the Vietnamese framework do not, so
        those coverage figures are estimates and labelled as such.
      </Text>
    </Screen>
  );
}

const createStyles = (theme: ResolvedTheme) => ({
  row: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: spacing.md,
    paddingVertical: spacing.md,
  },
  dot: { width: 10, height: 10, borderRadius: 5 },
  text: { flex: 1, gap: 2 },
  name: { color: theme.colors.ink, fontSize: typography.heading, fontWeight: weight.medium },
  meta: { color: theme.colors.inkMuted, fontSize: typography.micro },
  trailing: { color: theme.colors.inkFaint, fontSize: typography.micro },
  footnote: { color: theme.colors.inkFaint, fontSize: typography.micro, lineHeight: 16 },
});
