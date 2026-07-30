import React, { useMemo } from 'react';
import { Text, View } from 'react-native';
import { findExamLevel, getExaminedSkills, getLanguageProfile, getWeightedCardKinds, kindLabel } from '@language-srs/core';
import { useEngine } from '../src/engine/EngineProvider';
import { Body, Caption, Chip, Heading, Panel, ProgressBar, Row, Screen, StatTile } from '../src/components/ui';
import { spacing, typography, useTheme, useThemedStyles, type ResolvedTheme } from '../src/theme';

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

  const { profile, language, level, stats, readiness } = view;
  const peakForecast = Math.max(1, ...stats.forecast.map((day) => day.due));

  return (
    <Screen>
      <Panel>
        <Heading>
          {language.emoji} {level?.name}
        </Heading>
        <Caption>{readiness.headline}</Caption>
        <ProgressBar value={readiness.score} />

        <Row style={styles.tiles}>
          <StatTile label="Readiness" value={`${Math.round(readiness.score * 100)}%`} />
          <StatTile
            label="Words known"
            value={String(stats.coverage.entriesKnown)}
            hint={`of ${stats.coverage.target.toLocaleString()} target`}
          />
          <StatTile
            label="Days to exam"
            value={readiness.daysToExam !== undefined ? String(Math.max(0, readiness.daysToExam)) : '—'}
            hint={profile.examDate ?? 'no date set'}
          />
        </Row>
      </Panel>

      <Panel>
        <Heading>Retention</Heading>
        {stats.retention.reviews === 0 ? (
          <Body muted>No graduated reviews yet. These figures appear once cards start coming back.</Body>
        ) : (
          <>
            <Row style={styles.tiles}>
              <StatTile
                label="Actual"
                value={`${Math.round(stats.retention.trueRetention * 100)}%`}
                hint={`${stats.retention.reviews} reviews, 30d`}
              />
              <StatTile
                label="Predicted"
                value={`${Math.round(stats.retention.predictedRetention * 100)}%`}
                hint="what the model expected"
              />
              <StatTile
                label="Per card"
                value={`${stats.retention.averageSecondsPerCard.toFixed(1)}s`}
                hint="average"
              />
            </Row>
            <Caption>{describeCalibration(stats.retention.calibrationGap)}</Caption>
          </>
        )}
      </Panel>

      <Panel>
        <Heading>Next two weeks</Heading>
        <Caption>Reviews already scheduled. New cards are governed by your daily limit and are not counted here.</Caption>

        <View style={styles.chart}>
          {stats.forecast.map((day) => (
            <View key={day.day} style={styles.chartColumn}>
              <View style={styles.chartBarArea}>
                <View
                  style={[
                    styles.chartBar,
                    {
                      height: `${(day.due / peakForecast) * 100}%`,
                      backgroundColor: day.due > profile.dailyReviewLimit ? theme.colors.warning : theme.colors.accent,
                    },
                  ]}
                />
              </View>
              <Text style={styles.chartLabel}>{day.day.slice(8)}</Text>
            </View>
          ))}
        </View>

        {stats.forecast.some((day) => day.due > profile.dailyReviewLimit) ? (
          <Caption>
            Days in amber exceed your {profile.dailyReviewLimit}-review cap; the overflow rolls forward.
          </Caption>
        ) : null}
      </Panel>

      <Panel>
        <Heading>Card pipeline</Heading>
        <Row style={styles.tiles}>
          <StatTile label="Unseen" value={String(stats.coverage.newCards)} color={theme.colors.textMuted} />
          <StatTile label="Learning" value={String(stats.coverage.learningCards)} color={theme.colors.hard} />
          <StatTile label="In review" value={String(stats.coverage.reviewCards)} color={theme.colors.good} />
          <StatTile
            label="Leeches"
            value={String(stats.coverage.leeches)}
            color={stats.coverage.leeches > 0 ? theme.colors.danger : theme.colors.textMuted}
          />
        </Row>
        {stats.coverage.leeches > 0 ? (
          <Caption>
            Leeches have lapsed repeatedly. They are usually a sign the card is badly worded rather than the word being
            hard — rewriting the gloss or adding a mnemonic works better than grinding them.
          </Caption>
        ) : null}
      </Panel>

      <Panel>
        <Heading>Streak</Heading>
        <Row style={styles.tiles}>
          <StatTile label="Current" value={String(stats.streak.current)} color={theme.colors.warning} />
          <StatTile label="Longest" value={String(stats.streak.longest)} />
          <StatTile label="Days studied" value={String(stats.streak.totalDays)} />
        </Row>
        <Caption>The study day rolls over at {profile.dayStartHour}:00, so a late-night session counts for the day it started.</Caption>
      </Panel>

      {level ? (
        <Panel>
          <Heading>What {level.shortName} actually tests</Heading>
          <Row style={styles.wrap}>
            {getExaminedSkills(level).map((skill) => (
              <Chip key={skill} label={skill.toUpperCase()} />
            ))}
          </Row>

          <View style={styles.sections}>
            {level.sections.map((section) => (
              <Row key={section.id} style={styles.sectionRow}>
                <Text style={styles.sectionName}>{section.name}</Text>
                <Caption>
                  {[
                    section.questionCount ? `${section.questionCount} q` : undefined,
                    section.maxScore ? `${section.maxScore} pts` : undefined,
                    section.durationMinutes ? `${section.durationMinutes} min` : undefined,
                    section.minimumScore ? `min ${section.minimumScore}` : undefined,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </Caption>
              </Row>
            ))}
          </View>

          <Caption>Your sessions are weighted to match:</Caption>
          <Row style={styles.wrap}>
            {getWeightedCardKinds(level).map(({ kind, weight }) => (
              <View key={kind} style={[styles.weightPill, { borderColor: theme.kindColors[kind] ?? theme.colors.accent }]}>
                <Text style={[styles.weightLabel, { color: theme.kindColors[kind] ?? theme.colors.accent }]}>
                  {kindLabel(kind)} ×{weight}
                </Text>
              </View>
            ))}
          </Row>
        </Panel>
      ) : null}
    </Screen>
  );
}

/**
 * Turn the calibration gap into advice.
 *
 * The gap is what the model predicted minus what actually happened. Positive
 * means intervals are too long for this learner; sharply negative means they are
 * paying for retention they are not asking for.
 */
function describeCalibration(gap: number): string {
  if (Math.abs(gap) < 0.05) return 'The scheduler is well calibrated to you — predictions match your results.';
  if (gap > 0) {
    return `The scheduler is ${Math.round(gap * 100)} points optimistic. Raising target retention will shorten intervals.`;
  }
  return `You are recalling ${Math.round(-gap * 100)} points better than predicted. Lowering target retention would cut your daily load.`;
}

const createStyles = (theme: ResolvedTheme) => ({
  tiles: { alignItems: 'flex-start' as const, marginTop: spacing.sm },
  wrap: { flexWrap: 'wrap' as const, gap: spacing.sm },
  chart: {
    flexDirection: 'row' as const,
    gap: 4,
    height: 110,
    alignItems: 'flex-end' as const,
    marginTop: spacing.sm,
  },
  chartColumn: { flex: 1, alignItems: 'center' as const, gap: 4, height: '100%' as const },
  chartBarArea: { flex: 1, width: '100%' as const, justifyContent: 'flex-end' as const },
  chartBar: { width: '100%' as const, borderRadius: theme.radius.control, minHeight: 2 },
  chartLabel: { color: theme.colors.textFaint, fontSize: typography.micro },
  sections: { gap: spacing.sm, marginTop: spacing.sm },
  sectionRow: { justifyContent: 'space-between' as const },
  sectionName: { color: theme.colors.text, fontSize: typography.body },
  weightPill: {
    borderWidth: 1,
    borderRadius: theme.radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 3,
  },
  weightLabel: { fontSize: typography.micro, fontWeight: '700' as const },
});
