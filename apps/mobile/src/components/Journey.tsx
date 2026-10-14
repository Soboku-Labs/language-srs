import React from 'react';
import { Platform, Text, View } from 'react-native';
import type { DailyGoal, Journey } from '@mon/core';
import { Press } from '../motion/components';
import { spacing, typography, useTheme, useThemedStyles, weight, type ResolvedTheme } from '../theme';

/**
 * The two loops.
 *
 * Gamification here is deliberately two things and no more: a day that can be
 * finished, and a rank that takes months. Those are the two mechanics that
 * survive contact with an adult learner — the first because it ends, the second
 * because it is worth having. Everything else the category reaches for — gems,
 * hearts, leagues, streak insurance, a mascot with feelings — exists to raise
 * session count, and would be dishonest in an app whose entire claim is that its
 * numbers mean what they say.
 */

/**
 * Today, as a row of segments.
 *
 * A bar rather than a ring, because the app has no SVG renderer and faking an arc
 * out of rotated borders is a lot of machinery for a shape. Segmented rather than
 * continuous because a segment is a card: the thing fills by discrete units of
 * work you actually did, and on a twelve-card day you can count your way to the
 * end by eye.
 */
export function DayProgress({ goal }: { goal: DailyGoal }) {
  const theme = useTheme();
  const styles = useThemedStyles(createStyles);

  // Capped so a 200-review day does not render two hundred hairlines.
  const segments = Math.min(Math.max(goal.target, 1), 12);
  const filled = goal.target === 0 ? segments : (goal.done / goal.target) * segments;

  return (
    <View style={styles.segments} accessibilityRole="progressbar">
      {Array.from({ length: segments }, (_, index) => {
        // The partially-done segment is dimmed rather than clipped: it reads as
        // "in progress" without pretending to a precision a segment cannot carry.
        const whole = index + 1 <= Math.floor(filled);
        const partial = !whole && index < filled;
        return (
          <View
            key={index}
            style={[
              styles.segment,
              whole && { backgroundColor: theme.colors.accent },
              partial && { backgroundColor: theme.colors.accentSoft },
            ]}
          />
        );
      })}
    </View>
  );
}

/**
 * The rank.
 *
 * The native glyph is the hero and is set large, because it is the part worth
 * recognising — a learner should come to know 立春 or ㄷ or Mão as a place they
 * have been, the way a belt colour means something. The romanisation and gloss
 * sit under it in the quietest type on the screen, there for the first few
 * sightings and ignorable after that.
 */
export function RankBand({ journey, onPress }: { journey: Journey; onPress?: () => void }) {
  const theme = useTheme();
  const styles = useThemedStyles(createStyles);

  const body = (
    <>
      <View style={styles.rankGlyphBox}>
        <Text style={styles.rankGlyph} numberOfLines={1} adjustsFontSizeToFit>
          {journey.stage.native}
        </Text>
      </View>

      <View style={styles.rankText}>
        <Text style={styles.rankName}>
          {journey.stage.romanised ?? journey.stage.native}
          <Text style={styles.rankMeaning}> · {journey.stage.meaning}</Text>
        </Text>

        {/*
          The sentence that keeps this honest. The rank is words known, so the
          line under it says words known — not "level 4", not a point total with
          no unit, and nothing the learner cannot verify on the Words screen.
        */}
        <Text style={styles.rankDetail}>
          {journey.wordsToNext !== undefined
            ? `${journey.wordsKnown} words known · ${journey.wordsToNext} more to ${
                journey.next?.romanised ?? journey.next?.native
              }`
            : `${journey.wordsKnown} words known · top of the ladder`}
        </Text>

        <View style={styles.rankTrack}>
          <View
            style={[
              styles.rankFill,
              {
                width: `${Math.max(2, Math.round(journey.progress * 100))}%`,
                backgroundColor: theme.colors.accent,
              },
            ]}
          />
        </View>
      </View>

      <Text style={styles.rankCount}>
        {journey.stageNumber}
        <Text style={styles.rankTotal}>/{journey.totalStages}</Text>
      </Text>
    </>
  );

  if (!onPress) return <View style={styles.rank}>{body}</View>;

  return (
    <Press
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Rank ${journey.stage.romanised ?? journey.stage.native}, ${
        journey.stage.meaning
      }, stage ${journey.stageNumber} of ${journey.totalStages}`}
      style={styles.rank}
    >
      {body}
    </Press>
  );
}

/**
 * The whole ladder, for the progress screen.
 *
 * Shows where you have been and what is ahead with its price in words. The stages
 * above are not blurred or hidden: an achievement system that conceals what it
 * wants from you is a slot machine, and this one is a syllabus.
 */
export function Ladder({ journey, stages }: { journey: Journey; stages: Journey['stage'][] }) {
  const theme = useTheme();
  const styles = useThemedStyles(createStyles);

  return (
    <View style={styles.ladder}>
      {stages.map((stage) => {
        const reached = stage.index < journey.stageNumber - 1;
        const current = stage.index === journey.stageNumber - 1;

        return (
          <View key={stage.index} style={styles.ladderRow}>
            <Text
              style={[
                styles.ladderGlyph,
                reached && { color: theme.colors.inkMuted },
                current && { color: theme.colors.accent },
              ]}
            >
              {stage.native}
            </Text>
            <View style={styles.ladderText}>
              <Text style={[styles.ladderName, current && { fontWeight: weight.strong }]}>
                {stage.romanised ?? stage.native}
              </Text>
              <Text style={styles.ladderMeaning}>{stage.meaning}</Text>
            </View>
            <Text style={[styles.ladderWords, current && { color: theme.colors.ink }]}>
              {current ? 'you are here' : `${stage.wordsRequired} words`}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

const createStyles = (theme: ResolvedTheme) => ({
  segments: { flexDirection: 'row' as const, gap: 4, alignSelf: 'stretch' as const },
  segment: {
    flex: 1,
    height: 4,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.surfaceRaised,
  },

  rank: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: spacing.md,
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.card,
    padding: spacing.md,
    ...Platform.select({ web: { cursor: 'pointer' as const }, default: {} }),
  },
  rankGlyphBox: {
    width: 52,
    height: 52,
    borderRadius: theme.radius.control,
    backgroundColor: theme.colors.accentSoft,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  rankGlyph: {
    color: theme.colors.accent,
    fontSize: 24,
    fontWeight: weight.medium,
    textAlign: 'center' as const,
  },
  rankText: { flex: 1, gap: 3 },
  rankName: { color: theme.colors.ink, fontSize: typography.body, fontWeight: weight.medium },
  rankMeaning: { color: theme.colors.inkMuted, fontWeight: weight.regular },
  rankDetail: { color: theme.colors.inkMuted, fontSize: typography.micro },
  rankTrack: {
    height: 3,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.surfaceRaised,
    overflow: 'hidden' as const,
    marginTop: 2,
  },
  rankFill: { height: '100%' as const, borderRadius: theme.radius.pill },
  rankCount: { color: theme.colors.ink, fontSize: typography.caption, fontWeight: weight.medium },
  rankTotal: { color: theme.colors.inkFaint, fontWeight: weight.regular },

  ladder: { gap: 0 },
  ladderRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  ladderGlyph: {
    color: theme.colors.inkFaint,
    fontSize: typography.heading,
    width: 40,
    textAlign: 'center' as const,
  },
  ladderText: { flex: 1, gap: 1 },
  ladderName: { color: theme.colors.ink, fontSize: typography.caption },
  ladderMeaning: { color: theme.colors.inkMuted, fontSize: typography.micro },
  ladderWords: { color: theme.colors.inkFaint, fontSize: typography.micro },
});
