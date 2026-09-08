import React, { useMemo } from 'react';
import { Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { findExamLevel, getLanguageProfile, kindLabel, type CardKind } from '@language-srs/core';
import { useEngine } from '../src/engine/EngineProvider';
import { BigButton, Caption, Row, Screen, Stat, TextButton, Title } from '../src/components/ui';
import { CountUp, Press, Rise } from '../src/motion/components';
import { spacing, typography, useTheme, useThemedStyles, weight, type ResolvedTheme } from '../src/theme';

/**
 * The dashboard.
 *
 * One question, answered immediately: is there anything to study, and how much.
 *
 * The session mix used to be shown here as a stacked colour bar with a legend. It
 * was the last decorative use of colour in the app, and it was restating something
 * a short line of text says better — so the bar went and the sentence stayed.
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
      // Counted from a learn-mode queue rather than from the mixed one: the
      // dashboard queue interleaves new cards with reviews under a combined
      // limit, so its `fresh` count is what today's session happens to include,
      // not how many new words are actually available to take on.
      freshRemaining: engine.getQueue({ mode: 'learn' }).cards.length,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, revision]);

  const { profile, language, level, queue, stats, readiness, freshRemaining } = view;
  const waiting = queue.breakdown.due + queue.breakdown.fresh + queue.breakdown.learning;

  return (
    <Screen>
      {/* Tapping the language is how you switch it — no menu needed. */}
      <Rise index={0}>
        <Press onPress={() => router.push('/languages')} style={styles.header}>
          <View style={styles.headerText}>
            <Title>{language.name}</Title>
            <Caption>
              {level?.shortName}
              {profile.examDate ? ` · ${describeCountdown(readiness.daysToExam)}` : ''}
            </Caption>
          </View>
          <Text style={styles.chevron}>›</Text>
        </Press>
      </Rise>

      <Rise index={1} style={styles.hero}>
        {waiting > 0 ? (
          <>
            <CountUp value={waiting} style={styles.count} />
            <Text style={styles.countLabel}>{waiting === 1 ? 'card waiting' : 'cards waiting'}</Text>
          </>
        ) : (
          <>
            <Text style={styles.count}>—</Text>
            <Text style={styles.countLabel}>All caught up</Text>
            <Caption>
              {queue.nextDueAt
                ? `More lands ${formatRelative(queue.nextDueAt)}`
                : 'Raise your daily new-card limit to keep going'}
            </Caption>
          </>
        )}
      </Rise>

      <Rise index={2}>
        <BigButton
          label={waiting > 0 ? 'Study' : 'Study ahead'}
          {...(waiting > 0 ? { hint: describeMix(queue.kindMix) } : {})}
          onPress={() => router.push(waiting > 0 ? '/review' : '/review?mode=cram')}
        />
      </Rise>

      {/*
        The other two sessions, as text under the button rather than as buttons
        beside it. There is one thing to do here — study what is due — and modes
        are for the days you want something else. Making all three equally loud
        would turn a dashboard into a menu, and put a decision in front of the
        learner before they had done anything.
      */}
      <Rise index={3}>
        <Row style={styles.modes}>
          <ModeLink
            label="Learn new"
            detail={freshRemaining > 0 ? `${freshRemaining} ready` : 'none left today'}
            disabled={freshRemaining === 0}
            onPress={() => router.push('/review?mode=learn')}
          />
          <ModeLink
            label="Cram"
            detail={profile.examDate ? describeCountdown(readiness.daysToExam) : 'weakest first'}
            onPress={() => router.push('/review?mode=cram')}
          />
          <ModeLink
            label="Words"
            detail={`${stats.coverage.entriesStarted} started`}
            onPress={() => router.push('/words')}
          />
        </Row>
      </Rise>

      <Rise index={4}>
        <Row style={styles.stats}>
          <Stat
            label="day streak"
            value={String(stats.streak.current)}
            color={stats.streak.current > 0 ? theme.colors.ink : theme.colors.inkMuted}
          />
          <Stat label="words known" value={String(stats.coverage.entriesKnown)} />
          <Stat
            label={profile.examDate ? 'exam ready' : 'syllabus'}
            value={`${Math.round((profile.examDate ? readiness.score : readiness.coverage) * 100)}%`}
          />
        </Row>
      </Rise>

      <Rise index={5}>
        <Row style={styles.links}>
          <TextButton label="Progress" onPress={() => router.push('/stats')} />
          <TextButton label="Settings" onPress={() => router.push('/settings')} color={theme.colors.inkMuted} />
        </Row>
      </Rise>
    </Screen>
  );
}

/**
 * A secondary way in: a name, and one line saying what is behind it.
 *
 * The detail line is the point. "Cram" alone is a guess about what will happen;
 * "Cram · 12 days to go" is a reason to tap it or not.
 */
function ModeLink({
  label,
  detail,
  disabled,
  onPress,
}: {
  label: string;
  detail: string;
  disabled?: boolean;
  onPress: () => void;
}) {
  const styles = useThemedStyles(createStyles);

  return (
    <Press
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={`${label}, ${detail}`}
      accessibilityState={{ disabled: Boolean(disabled) }}
      style={[styles.mode, disabled && styles.modeDisabled]}
    >
      <Text style={styles.modeLabel}>{label}</Text>
      <Text style={styles.modeDetail}>{detail}</Text>
    </Press>
  );
}

/** "listening, meaning and tones" — the session mix as a phrase, not a chart. */
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
  header: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: spacing.md },
  headerText: { flex: 1, gap: 2 },
  chevron: { color: theme.colors.inkFaint, fontSize: 26 },

  hero: { alignItems: 'center' as const, gap: spacing.xs, paddingVertical: spacing.xxl },
  count: {
    color: theme.colors.ink,
    fontSize: typography.display,
    lineHeight: typography.display + 8,
    fontWeight: weight.regular,
    letterSpacing: -2,
  },
  countLabel: { color: theme.colors.inkMuted, fontSize: typography.body },

  modes: { gap: spacing.sm },
  mode: {
    flex: 1,
    gap: 1,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderRadius: theme.radius.control,
    backgroundColor: theme.colors.surface,
  },
  modeDisabled: { opacity: 0.4 },
  modeLabel: { color: theme.colors.ink, fontSize: typography.caption, fontWeight: weight.medium },
  modeDetail: { color: theme.colors.inkMuted, fontSize: typography.micro },

  stats: { justifyContent: 'space-between' as const },
  links: { justifyContent: 'center' as const, gap: spacing.xl },
});
