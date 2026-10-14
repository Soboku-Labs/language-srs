import React, { useMemo } from 'react';
import { Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { findExamLevel, getLanguageProfile, kindLabel, type CardKind } from '@language-srs/core';
import { useEngine } from '../src/engine/EngineProvider';
import { BigButton, Caption, Row, Screen, Stat, TextButton, Title } from '../src/components/ui';
import { DayProgress, RankBand } from '../src/components/Journey';
import { CountUp, Press, Rise } from '../src/motion/components';
import { spacing, typography, useTheme, useThemedStyles, weight, type ResolvedTheme } from '../src/theme';

/**
 * The dashboard.
 *
 * Two loops and one action.
 *
 * The **day** is the hero: how much of today's work is left, as a count and a row
 * of segments that fills. It ends. When it is clear the screen says so and stops
 * asking, which is the whole difference between a daily goal and a treadmill.
 *
 * The **journey** sits under the action: the learner's rank on their language's
 * own ladder, earned by words that have actually stuck. It moves on the scale of
 * weeks, so it is quiet — but it is the reason to come back after the day is
 * done, and it is the only ornament on the screen.
 *
 * What is deliberately absent: points, gems, tiers with no unit, anything that
 * rises because the app was opened. Every number here is one the learner could
 * check for themselves on another screen.
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
      journey: engine.getJourney(),
      goal: engine.getDailyGoal(),
      // Counted from a learn-mode queue rather than from the mixed one: the
      // dashboard queue interleaves new cards with reviews under a combined
      // limit, so its `fresh` count is what today's session happens to include,
      // not how many new words are actually available to take on.
      freshRemaining: engine.getQueue({ mode: 'learn' }).cards.length,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, revision]);

  const { profile, language, level, queue, stats, readiness, freshRemaining, journey, goal } = view;
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
        {goal.complete ? (
          <>
            {/*
              The close. A tick rather than a zero, because "0 cards waiting" is
              an absence and this is an achievement — and nothing underneath it
              proposes more work.
            */}
            <Text style={[styles.count, { color: theme.colors.good }]}>✓</Text>
            <Text style={styles.countLabel}>
              {goal.target > 0 ? 'Done for today' : 'Nothing due today'}
            </Text>
            <Caption>
              {goal.drillsLeft > 0
                ? `${goal.drillsLeft} drill${goal.drillsLeft === 1 ? '' : 's'} still on short steps`
                : queue.nextDueAt
                  ? `Next lands ${formatRelative(queue.nextDueAt)}`
                  : 'Raise your daily new-card limit to keep going'}
            </Caption>
          </>
        ) : (
          <>
            <CountUp value={goal.remaining} style={styles.count} />
            <Text style={styles.countLabel}>
              {goal.done > 0 ? `left of ${goal.target} today` : goal.remaining === 1 ? 'card today' : 'cards today'}
            </Text>
          </>
        )}
        <View style={styles.segmentsBox}>
          <DayProgress goal={goal} />
        </View>
      </Rise>

      <Rise index={2}>
        <BigButton
          label={goal.complete ? 'Study ahead' : goal.done > 0 ? 'Keep going' : 'Study'}
          {...(waiting > 0 ? { hint: describeMix(queue.kindMix) } : {})}
          onPress={() => router.push(goal.complete ? '/review?mode=cram' : '/review')}
        />
      </Rise>

      {/* The long loop. Tapping it opens the whole ladder on the progress screen. */}
      <Rise index={3}>
        <RankBand journey={journey} onPress={() => router.push('/stats')} />
      </Rise>

      {/*
        The other two sessions, as text under the button rather than as buttons
        beside it. There is one thing to do here — study what is due — and modes
        are for the days you want something else. Making all three equally loud
        would turn a dashboard into a menu, and put a decision in front of the
        learner before they had done anything.
      */}
      <Rise index={4}>
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

      <Rise index={5}>
        <Row style={styles.stats}>
          <Stat
            label="day streak"
            value={String(stats.streak.current)}
            color={stats.streak.current > 0 ? theme.colors.ink : theme.colors.inkMuted}
          />
          {/*
            "Words known" used to sit here too. The rank band above now states it
            in the sentence that explains the rank, and the same number twice on
            one screen is the kind of restatement this design keeps removing.
          */}
          {/*
            Two different questions, and the label has to say which one is being
            answered. Without an exam date this is progress through the deck,
            which can reach 100%. With one it is readiness for the paper, which
            is measured against the exam's own vocabulary and stays low while the
            deck is short of it — labelling deck progress "syllabus" was how the
            app came to report 5% to someone who had learned every word it had.
          */}
          <Stat
            label={profile.examDate ? 'exam ready' : 'deck learned'}
            value={`${Math.round((profile.examDate ? readiness.score : readiness.coverage) * 100)}%`}
          />
        </Row>
      </Rise>

      <Rise index={6}>
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

  hero: { alignItems: 'center' as const, gap: spacing.xs, paddingVertical: spacing.xl },
  segmentsBox: { alignSelf: 'stretch' as const, paddingTop: spacing.lg },
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
