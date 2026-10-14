import React, { useMemo } from 'react';
import { Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import {
  describeStruggle,
  findExamLevel,
  getExaminedSkills,
  getLanguageProfile,
  kindLabel,
  type KindRetention,
} from '@language-srs/core';
import { getLadder } from '@language-srs/core';
import { useEngine } from '../src/engine/EngineProvider';
import { Ladder, RankBand } from '../src/components/Journey';
import {
  Caption,
  DetailRow,
  Pill,
  ProgressBar,
  Row,
  Screen,
  Section,
  Stat,
  TextButton,
  Title,
} from '../src/components/ui';
import { Press, Rise } from '../src/motion/components';
import { spacing, typography, useTheme, useThemedStyles, weight, type ResolvedTheme } from '../src/theme';

/**
 * Progress.
 *
 * The detail the dashboard deliberately does not carry. Grouped by the question
 * each part answers — how ready am I, what is coming, how am I doing — with space
 * between the groups instead of a border around each one.
 */
export default function StatsScreen() {
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
      stats: engine.getStats(),
      readiness: engine.getReadiness(),
      struggling: engine.getStrugglingCards(),
      journey: engine.getJourney(),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, revision]);

  const { profile, level, stats, readiness, struggling, journey } = view;
  const weakest = stats.retentionByKind[0];

  /**
   * One row per word, not per card.
   *
   * A word with five cards that are all going badly was listing the same word
   * five times, which reads as five separate problems and pushes everything else
   * off the list. The cards are already sorted worst-first, so the first one for
   * a word is the one worth naming.
   */
  const strugglingWords = useMemo(() => {
    const byEntry = new Map<string, (typeof struggling)[number] & { cardCount: number }>();
    for (const row of struggling) {
      const seen = byEntry.get(row.entry.id);
      if (seen) seen.cardCount += 1;
      else byEntry.set(row.entry.id, { ...row, cardCount: 1 });
    }
    return [...byEntry.values()];
  }, [struggling]);
  const peak = Math.max(1, ...stats.forecast.map((day) => day.due));
  const scheduled = stats.forecast.reduce((total, day) => total + day.due, 0);

  return (
    <Screen>
      {/*
        "Ready" is a claim about the exam and is only made when there is an exam
        to be ready for. Without a date this is progress through the deck, and
        saying so is the difference between a number and a promise — the caption
        underneath names the gap to the real syllabus either way.
      */}
      <Rise index={0} style={styles.headline}>
        <Title>
          {readiness.examDate
            ? `${Math.round(readiness.score * 100)}% ready`
            : `${Math.round(readiness.coverage * 100)}% of your deck`}
        </Title>
        <ProgressBar value={readiness.examDate ? readiness.score : readiness.coverage} />
        <Caption>{readiness.headline}</Caption>
      </Rise>

      <Rise index={1}>
        <Section title="Your journey">
          <RankBand journey={journey} />
          <Caption>{journey.tradition}.</Caption>
          {/*
            The stages ahead are listed with their price in words rather than
            hidden behind a lock. An achievement system that conceals what it
            wants from you is a slot machine; this one is a syllabus.
          */}
          <Ladder journey={journey} stages={getLadder(profile.languageCode).stages} />
        </Section>
      </Rise>

      <Rise index={2}>
        <Row style={styles.stats}>
        <Stat label="known" value={String(stats.coverage.entriesKnown)} />
        <Stat label="learning" value={String(stats.coverage.learningCards)} color={theme.colors.hard} />
        <Stat label="in review" value={String(stats.coverage.reviewCards)} color={theme.colors.good} />
          <Stat label="unseen" value={String(stats.coverage.newCards)} color={theme.colors.inkMuted} />
        </Row>
      </Rise>

      <Rise index={3}>
      <Section title="Next two weeks">
        {/* An all-zero chart renders as a row of stubs that look like data. Until
            something is actually scheduled, say so instead of drawing it. */}
        {scheduled === 0 ? (
          <Caption>Nothing scheduled yet — reviews appear here once today&apos;s cards graduate.</Caption>
        ) : (
          <>
            <View style={styles.chart}>
              {stats.forecast.map((day) => (
                <View key={day.day} style={styles.chartColumn}>
                  <View style={styles.chartBarArea}>
                    {day.due > 0 ? (
                      <View
                        style={[
                          styles.chartBar,
                          {
                            height: `${(day.due / peak) * 100}%`,
                            backgroundColor:
                              day.due > profile.dailyReviewLimit ? theme.colors.caution : theme.colors.accent,
                          },
                        ]}
                      />
                    ) : null}
                  </View>
                  <Text style={styles.chartLabel}>{day.day.slice(8)}</Text>
                </View>
              ))}
            </View>
            <Caption>
              {stats.forecast.some((day) => day.due > profile.dailyReviewLimit)
                ? `Amber days exceed your ${profile.dailyReviewLimit}-review cap; the overflow rolls forward.`
                : 'Reviews already scheduled. New cards are governed by your daily limit.'}
            </Caption>
          </>
        )}
      </Section>
      </Rise>

      <Rise index={4}>
      <Section title="How it is going">
        {stats.retention.reviews === 0 ? (
          <Caption>No graduated reviews yet — these appear once cards start coming back.</Caption>
        ) : (
          <>
            <DetailRow label="Recalled" value={`${Math.round(stats.retention.trueRetention * 100)}%`} />
            <DetailRow label="Model predicted" value={`${Math.round(stats.retention.predictedRetention * 100)}%`} />
            <DetailRow label="Seconds per card" value={stats.retention.averageSecondsPerCard.toFixed(1)} />
            <Caption>{describeCalibration(stats.retention.calibrationGap)}</Caption>
          </>
        )}
        <DetailRow label="Current streak" value={`${stats.streak.current} days`} />
        <DetailRow label="Longest streak" value={`${stats.streak.longest} days`} />
      </Section>
      </Rise>

      {/*
        These exams are sectioned by skill and the queue already mirrors that mix,
        so one overall retention figure averages away the only thing it could have
        told the learner: that their reading is fine and their listening is not.
      */}
      {stats.retentionByKind.length > 1 ? (
        <Rise index={5}>
          <Section title="By skill">
            {stats.retentionByKind.map((row) => (
              <View key={row.kind} style={styles.skillRow}>
                <Text style={styles.skillLabel}>{kindLabel(row.kind)}</Text>
                <View style={styles.skillTrack}>
                  <View
                    style={[
                      styles.skillFill,
                      {
                        width: `${Math.max(2, Math.round(row.trueRetention * 100))}%`,
                        backgroundColor:
                          row.trueRetention >= profile.desiredRetention
                            ? theme.colors.good
                            : theme.colors.caution,
                      },
                    ]}
                  />
                </View>
                <Text style={styles.skillValue}>{Math.round(row.trueRetention * 100)}%</Text>
              </View>
            ))}
            <Caption>{describeWeakestSkill(stats.retentionByKind, profile.desiredRetention)}</Caption>
            {/* The weakest skill is only useful if something can be done about it
                in the same breath, and the review screen already takes a kind. */}
            {weakest && weakest.trueRetention < profile.desiredRetention ? (
              <TextButton
                label={`Drill ${kindLabel(weakest.kind).toLowerCase()}`}
                onPress={() => router.push(`/review?mode=cram&kind=${weakest.kind}`)}
              />
            ) : null}
          </Section>
        </Rise>
      ) : null}

      {/*
        A count of your worst cards that you cannot act on is worse than no count,
        so the number now comes with the way to deal with them.
      */}
      {strugglingWords.length > 0 ? (
        <Rise index={6}>
          <Section title="Fighting you">
            {strugglingWords.slice(0, 6).map((row) => (
              <Press
                key={row.entry.id}
                onPress={() => router.push(`/word/${encodeURIComponent(row.entry.id)}`)}
                accessibilityRole="button"
                style={styles.struggleRow}
              >
                <Text style={styles.struggleTarget}>{row.entry.target}</Text>
                <Text style={styles.struggleWhy} numberOfLines={1}>
                  {row.cardCount > 1 ? `${row.cardCount} cards · ` : ''}
                  {describeStruggle(row)}
                </Text>
              </Press>
            ))}
            {strugglingWords.length > 6 ? (
              <Caption>and {strugglingWords.length - 6} more</Caption>
            ) : null}
            <Caption>
              Usually the card is badly worded rather than the word being hard. Open one to add a note, start
              it over, or set it aside.
            </Caption>
          </Section>
        </Rise>
      ) : null}

      {level ? (
        <Rise index={7}>
        <Section title={`What ${level.shortName} tests`}>
          <Row style={styles.wrap}>
            {getExaminedSkills(level).map((skill) => (
              <Pill key={skill} label={skill} />
            ))}
          </Row>
          {level.sections.map((section) => (
            <DetailRow
              key={section.id}
              label={section.name}
              value={[
                section.questionCount ? `${section.questionCount} q` : undefined,
                section.maxScore ? `${section.maxScore} pts` : undefined,
                section.durationMinutes ? `${section.durationMinutes} min` : undefined,
              ]
                .filter(Boolean)
                .join(' · ')}
            />
          ))}
          {level.passingScore && level.totalScore ? (
            <DetailRow label="Pass mark" value={`${level.passingScore} of ${level.totalScore}`} />
          ) : null}
          <Caption>Your sessions are weighted to match this mix.</Caption>
        </Section>
        </Rise>
      ) : null}
    </Screen>
  );
}

/**
 * Turn the calibration gap into advice.
 *
 * The gap is what the model predicted minus what actually happened. Positive means
 * intervals are too long for this learner; sharply negative means they are paying
 * for retention they are not asking for.
 */
function describeCalibration(gap: number): string {
  if (Math.abs(gap) < 0.05) return 'The scheduler is well calibrated to you.';
  if (gap > 0) {
    return `The scheduler is ${Math.round(gap * 100)} points optimistic. Raising target retention shortens intervals.`;
  }
  return `You are recalling ${Math.round(-gap * 100)} points better than predicted. Lowering target retention would cut your daily load.`;
}

/**
 * Name the weakest skill, or say there isn't one.
 *
 * A list of percentages is a reading exercise; the sentence under it is the part
 * that tells the learner what to do on the days they only have twenty minutes.
 */
function describeWeakestSkill(rows: KindRetention[], desired: number): string {
  const weakest = rows[0];
  if (!weakest) return '';

  if (weakest.trueRetention >= desired) {
    return `Every skill is at or above your ${Math.round(desired * 100)}% target.`;
  }

  const gap = Math.round((desired - weakest.trueRetention) * 100);
  return `${kindLabel(weakest.kind)} is ${gap} points below your target — the weakest of ${rows.length} skills.`;
}

const createStyles = (theme: ResolvedTheme) => ({
  headline: { gap: spacing.sm },
  stats: { justifyContent: 'space-between' as const },
  wrap: { flexWrap: 'wrap' as const, gap: spacing.sm },
  chart: { flexDirection: 'row' as const, gap: 4, height: 96, alignItems: 'flex-end' as const },
  chartColumn: { flex: 1, alignItems: 'center' as const, gap: 4, height: '100%' as const },
  chartBarArea: { flex: 1, width: '100%' as const, justifyContent: 'flex-end' as const },
  chartBar: { width: '100%' as const, borderRadius: theme.radius.control, minHeight: 3 },
  chartLabel: { color: theme.colors.inkFaint, fontSize: typography.micro },

  skillRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  skillLabel: { color: theme.colors.ink, fontSize: typography.caption, width: 84 },
  skillTrack: {
    flex: 1,
    height: 3,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.surfaceRaised,
    overflow: 'hidden' as const,
  },
  skillFill: { height: '100%' as const, borderRadius: theme.radius.pill },
  skillValue: {
    color: theme.colors.inkMuted,
    fontSize: typography.micro,
    width: 34,
    textAlign: 'right' as const,
  },

  struggleRow: {
    flexDirection: 'row' as const,
    alignItems: 'baseline' as const,
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  struggleTarget: { color: theme.colors.ink, fontSize: typography.body, fontWeight: weight.medium },
  struggleWhy: { color: theme.colors.inkMuted, fontSize: typography.caption, flex: 1 },
});
