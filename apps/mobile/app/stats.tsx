import React, { useMemo } from 'react';
import { Text, View } from 'react-native';
import { findExamLevel, getExaminedSkills, getLanguageProfile } from '@language-srs/core';
import { useEngine } from '../src/engine/EngineProvider';
import { Caption, DetailRow, Pill, ProgressBar, Row, Screen, Section, Stat, Title } from '../src/components/ui';
import { Rise } from '../src/motion/components';
import { spacing, typography, useTheme, useThemedStyles, type ResolvedTheme } from '../src/theme';

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

  const view = useMemo(() => {
    const profile = engine.getProfile();
    return {
      profile,
      language: getLanguageProfile(profile.languageCode),
      level: findExamLevel(profile.targetLevelId),
      stats: engine.getStats(),
      readiness: engine.getReadiness(),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, revision]);

  const { profile, level, stats, readiness } = view;
  const peak = Math.max(1, ...stats.forecast.map((day) => day.due));
  const scheduled = stats.forecast.reduce((total, day) => total + day.due, 0);

  return (
    <Screen>
      <Rise index={0} style={styles.headline}>
        <Title>{Math.round(readiness.score * 100)}% ready</Title>
        <ProgressBar value={readiness.score} />
        <Caption>{readiness.headline}</Caption>
      </Rise>

      <Rise index={1}>
        <Row style={styles.stats}>
        <Stat label="known" value={String(stats.coverage.entriesKnown)} />
        <Stat label="learning" value={String(stats.coverage.learningCards)} color={theme.colors.hard} />
        <Stat label="in review" value={String(stats.coverage.reviewCards)} color={theme.colors.good} />
          <Stat label="unseen" value={String(stats.coverage.newCards)} color={theme.colors.textMuted} />
        </Row>
      </Rise>

      <Rise index={2}>
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
                              day.due > profile.dailyReviewLimit ? theme.colors.warning : theme.colors.accent,
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

      <Rise index={3}>
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
        {stats.coverage.leeches > 0 ? (
          <>
            <DetailRow label="Leeches" value={String(stats.coverage.leeches)} />
            <Caption>
              Leeches have lapsed repeatedly. Usually the card is badly worded rather than the word being hard —
              rewriting the gloss beats grinding them.
            </Caption>
          </>
        ) : null}
      </Section>
      </Rise>

      {level ? (
        <Rise index={4}>
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

const createStyles = (theme: ResolvedTheme) => ({
  headline: { gap: spacing.sm },
  stats: { justifyContent: 'space-between' as const },
  wrap: { flexWrap: 'wrap' as const, gap: spacing.sm },
  chart: { flexDirection: 'row' as const, gap: 4, height: 96, alignItems: 'flex-end' as const },
  chartColumn: { flex: 1, alignItems: 'center' as const, gap: 4, height: '100%' as const },
  chartBarArea: { flex: 1, width: '100%' as const, justifyContent: 'flex-end' as const },
  chartBar: { width: '100%' as const, borderRadius: theme.radius.pill, minHeight: 3 },
  chartLabel: { color: theme.colors.textFaint, fontSize: typography.micro },
});
