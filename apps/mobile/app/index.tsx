import React, { useMemo } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { findExamLevel, getLanguageProfile, kindLabel, type CardKind } from '@language-srs/core';
import { useEngine } from '../src/engine/EngineProvider';
import { BigButton, Caption, Row, Screen, Stat, TextButton, Title } from '../src/components/ui';
import { spacing, typography, useTheme, useThemedStyles, type ResolvedTheme } from '../src/theme';

/**
 * The dashboard.
 *
 * One question, answered immediately: is there anything to study, and how much.
 * An earlier version stacked six bordered panels here — today, session mix,
 * readiness, streak tiles, actions — which meant nothing stood out and the answer
 * took a scroll to find. Everything except the count, the button and a single row
 * of context now lives on the Progress screen, one tap away.
 */
export default function Dashboard() {
  const { engine, revision } = useEngine();
  const theme = useTheme();
  const styles = useThemedStyles(createStyles);
  const router = useRouter();

  const view = useMemo(() => {
    const profile = engine.getProfile();
    return {
      profile,
      language: getLanguageProfile(profile.languageCode),
      level: findExamLevel(profile.targetLevelId),
      queue: engine.getQueue(),
      stats: engine.getStats(),
      readiness: engine.getReadiness(),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, revision]);

  const { profile, language, level, queue, stats, readiness } = view;
  const waiting = queue.breakdown.due + queue.breakdown.fresh + queue.breakdown.learning;

  return (
    <Screen>
      {/* Tapping the language is how you switch it — no menu needed. */}
      <Pressable onPress={() => router.push('/languages')} style={styles.header}>
        <Text style={styles.emoji}>{language.emoji}</Text>
        <View style={styles.headerText}>
          <Title>{language.name}</Title>
          <Caption>
            {level?.shortName}
            {profile.examDate ? ` · ${describeCountdown(readiness.daysToExam)}` : ''}
          </Caption>
        </View>
        <Text style={styles.chevron}>›</Text>
      </Pressable>

      <View style={styles.hero}>
        {waiting > 0 ? (
          <>
            <Text style={styles.count}>{waiting}</Text>
            <Text style={styles.countLabel}>
              {waiting === 1 ? 'card waiting' : 'cards waiting'}
            </Text>
            <MixBar mix={queue.kindMix} />
          </>
        ) : (
          <>
            <Text style={styles.count}>✨</Text>
            <Text style={styles.countLabel}>All caught up</Text>
            <Caption>
              {queue.nextDueAt
                ? `More lands ${formatRelative(queue.nextDueAt)}`
                : 'Raise your daily new-card limit to keep going'}
            </Caption>
          </>
        )}
      </View>

      <BigButton
        label={waiting > 0 ? 'Study now' : 'Study ahead'}
        {...(waiting > 0 && queue.kindMix ? { hint: describeMix(queue.kindMix) } : {})}
        onPress={() => router.push('/review')}
      />

      <Row style={styles.stats}>
        <Stat
          label={stats.streak.studiedToday ? 'day streak 🔥' : 'day streak'}
          value={String(stats.streak.current)}
          color={stats.streak.current > 0 ? theme.colors.secondary : theme.colors.textMuted}
        />
        <Stat label="words known" value={String(stats.coverage.entriesKnown)} />
        <Stat
          label={profile.examDate ? 'exam ready' : 'syllabus'}
          value={`${Math.round((profile.examDate ? readiness.score : readiness.coverage) * 100)}%`}
        />
      </Row>

      <Row style={styles.links}>
        <TextButton label="Progress" onPress={() => router.push('/stats')} />
        <TextButton label="Settings" onPress={() => router.push('/settings')} color={theme.colors.textMuted} />
      </Row>
    </Screen>
  );
}

/**
 * A thin band showing the session's card mix.
 *
 * The one piece of the old session-mix panel worth keeping on this screen: it
 * shows at a glance that the queue is shaped like the exam paper, without a
 * legend, a heading and a box to say so.
 */
function MixBar({ mix }: { mix: Partial<Record<CardKind, number>> }) {
  const theme = useTheme();
  const styles = useThemedStyles(createStyles);

  const entries = Object.entries(mix)
    .filter((entry): entry is [CardKind, number] => (entry[1] ?? 0) > 0)
    .sort((a, b) => b[1] - a[1]);

  if (entries.length === 0) return null;

  return (
    <View style={styles.mixBar}>
      {entries.map(([kind, count]) => (
        <View
          key={kind}
          style={{ flex: count, backgroundColor: theme.kindColors[kind] ?? theme.colors.accent, height: 6 }}
        />
      ))}
    </View>
  );
}

/** "listening, meaning and tones" — the mix as a phrase rather than a legend. */
function describeMix(mix: Partial<Record<CardKind, number>>): string {
  const kinds = Object.entries(mix)
    .filter((entry): entry is [CardKind, number] => (entry[1] ?? 0) > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([kind]) => kindLabel(kind).toLowerCase());

  if (kinds.length === 0) return '';
  if (kinds.length === 1) return kinds[0]!;
  return `${kinds.slice(0, -1).join(', ')} and ${kinds[kinds.length - 1]}`;
}

function describeCountdown(days?: number): string {
  if (days === undefined) return '';
  if (days < 0) return 'exam passed';
  if (days === 0) return 'exam today';
  if (days === 1) return 'exam tomorrow';
  return `${days} days to go`;
}

function formatRelative(at: string): string {
  const hours = (Date.parse(at) - Date.now()) / 3_600_000;
  if (hours < 1) return 'within the hour';
  if (hours < 24) return `in ${Math.round(hours)}h`;
  return `in ${Math.round(hours / 24)} days`;
}

const createStyles = (theme: ResolvedTheme) => ({
  header: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: spacing.md,
  },
  emoji: { fontSize: 34 },
  headerText: { flex: 1, gap: 1 },
  chevron: { color: theme.colors.textFaint, fontSize: 28 },

  hero: { alignItems: 'center' as const, gap: spacing.xs, paddingVertical: spacing.xxl },
  count: {
    color: theme.colors.accent,
    fontSize: 92,
    lineHeight: 100,
    fontWeight: '800' as const,
    letterSpacing: -2,
  },
  countLabel: { color: theme.colors.text, fontSize: typography.heading, fontWeight: '600' as const },
  mixBar: {
    flexDirection: 'row' as const,
    borderRadius: theme.radius.pill,
    overflow: 'hidden' as const,
    width: 160,
    marginTop: spacing.md,
  },

  stats: { justifyContent: 'space-between' as const, paddingHorizontal: spacing.sm },
  links: { justifyContent: 'center' as const, gap: spacing.xl },
});
