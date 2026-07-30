import React, { useMemo } from 'react';
import { Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import {
  findExamLevel,
  findExamTrack,
  getLanguageProfile,
  kindLabel,
  type CardKind,
} from '@language-srs/core';
import { useEngine } from '../src/engine/EngineProvider';
import {
  Body,
  Button,
  Caption,
  Chip,
  Heading,
  Panel,
  ProgressBar,
  Row,
  Screen,
  StatTile,
  Title,
} from '../src/components/ui';
import { spacing, typography, useTheme, useThemedStyles, type ResolvedTheme } from '../src/theme';

export default function Dashboard() {
  const { engine, revision } = useEngine();
  const theme = useTheme();
  const styles = useThemedStyles(createStyles);
  const router = useRouter();

  // Recomputed whenever the engine reports a change; see EngineProvider.
  const view = useMemo(() => {
    const profile = engine.getProfile();
    return {
      profile,
      language: getLanguageProfile(profile.languageCode),
      track: findExamTrack(profile.examTrackId),
      level: findExamLevel(profile.targetLevelId),
      queue: engine.getQueue(),
      stats: engine.getStats(),
      readiness: engine.getReadiness(),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, revision]);

  const { profile, language, track, level, queue, stats, readiness } = view;
  const dueTotal = queue.breakdown.due + queue.breakdown.fresh + queue.breakdown.learning;

  const verdictColors: Record<string, string> = {
    ready: theme.colors.success,
    'on-track': theme.colors.accent,
    behind: theme.colors.warning,
    'not-started': theme.colors.textMuted,
    'no-exam-set': theme.colors.textMuted,
    'exam-passed': theme.colors.textMuted,
  };
  const verdictColor = verdictColors[readiness.verdict] ?? theme.colors.accent;

  return (
    <Screen>
      <View style={styles.headerRow}>
        <View style={styles.headerText}>
          <Caption>{track?.name ?? profile.examTrackId}</Caption>
          <Title>
            {language.emoji} {language.name}
          </Title>
          <Caption>{level?.name}</Caption>
        </View>
        <Chip label={language.badge} />
      </View>

      <Panel>
        <Row style={styles.spaceBetween}>
          <Heading>Today</Heading>
          <Caption>
            {stats.today.newCards}/{profile.dailyNewLimit} new · {stats.today.reviews}/
            {profile.dailyReviewLimit} reviews
          </Caption>
        </Row>

        <Row style={styles.tiles}>
          <StatTile label="Due" value={String(queue.breakdown.due)} color={theme.colors.accent} />
          <StatTile label="New" value={String(queue.breakdown.fresh)} color={theme.colors.good} />
          <StatTile label="Learning" value={String(queue.breakdown.learning)} color={theme.colors.hard} />
        </Row>

        {queue.breakdown.heldByCap > 0 ? (
          <Caption>{queue.breakdown.heldByCap} more due, held back by your daily review cap.</Caption>
        ) : null}

        {dueTotal > 0 ? (
          <Button
            label={`Review ${dueTotal} card${dueTotal === 1 ? '' : 's'}`}
            onPress={() => router.push('/review')}
          />
        ) : (
          <View style={styles.emptyState}>
            <Body muted>
              {queue.nextDueAt
                ? `Nothing due. Next review ${formatRelative(queue.nextDueAt)}.`
                : 'Nothing due. Raise your daily new-card limit to keep going.'}
            </Body>
            <Button label="Study ahead anyway" tone="ghost" onPress={() => router.push('/review')} />
          </View>
        )}
      </Panel>

      {queue.cards.length > 0 ? <SessionMix mix={queue.kindMix} /> : null}

      <Panel onPress={() => router.push('/stats')}>
        <Row style={styles.spaceBetween}>
          <Heading>Exam readiness</Heading>
          <Text style={[styles.readinessPercent, { color: verdictColor }]}>
            {Math.round(readiness.score * 100)}%
          </Text>
        </Row>
        <ProgressBar value={readiness.score} color={verdictColor} />
        <Caption>{readiness.headline}</Caption>

        <Row style={styles.tiles}>
          <StatTile
            label="Syllabus known"
            value={`${Math.round(readiness.coverage * 100)}%`}
            hint={`${stats.coverage.entriesKnown} of ${stats.coverage.target} words`}
          />
          <StatTile
            label="Recall on exam day"
            value={readiness.examDate ? `${Math.round(readiness.projectedRecall * 100)}%` : '—'}
            hint={readiness.examDate ? 'if you stopped now' : 'set an exam date'}
          />
        </Row>
      </Panel>

      <Panel>
        <Row style={styles.tiles}>
          <StatTile
            label="Day streak"
            value={String(stats.streak.current)}
            hint={stats.streak.studiedToday ? 'studied today' : 'not yet today'}
            color={stats.streak.current > 0 ? theme.colors.secondary : theme.colors.textMuted}
          />
          <StatTile
            label="Retention"
            value={stats.retention.reviews > 0 ? `${Math.round(stats.retention.trueRetention * 100)}%` : '—'}
            hint={stats.retention.reviews > 0 ? `${stats.retention.reviews} reviews, 30d` : 'no reviews yet'}
          />
          <StatTile
            label="In review"
            value={String(stats.coverage.reviewCards)}
            hint={`${stats.coverage.newCards} unseen`}
          />
        </Row>
      </Panel>

      <Row style={styles.actions}>
        <View style={styles.action}>
          <Button label="Languages" tone="ghost" onPress={() => router.push('/languages')} />
        </View>
        <View style={styles.action}>
          <Button label="Settings" tone="ghost" onPress={() => router.push('/settings')} />
        </View>
      </Row>

      <Caption>Theme: {theme.name}. {theme.inspiration}</Caption>
    </Screen>
  );
}

/**
 * The kind mix of the queued session.
 *
 * Surfaced because it is the clearest signal that the app is exam-shaped rather
 * than a generic word list: a TOPIK II session visibly contains writing cards, a
 * JLPT session visibly contains none.
 */
function SessionMix({ mix }: { mix: Partial<Record<CardKind, number>> }) {
  const theme = useTheme();
  const styles = useThemedStyles(createStyles);

  const entries = Object.entries(mix)
    .filter((entry): entry is [CardKind, number] => (entry[1] ?? 0) > 0)
    .sort((a, b) => b[1] - a[1]);

  const total = entries.reduce((sum, [, count]) => sum + count, 0);
  if (total === 0) return null;

  return (
    <Panel>
      <Heading>This session mirrors your paper</Heading>
      <View style={styles.mixBar}>
        {entries.map(([kind, count]) => (
          <View
            key={kind}
            style={{
              flex: count,
              backgroundColor: theme.kindColors[kind] ?? theme.colors.accent,
              height: 10,
            }}
          />
        ))}
      </View>
      <View style={styles.legend}>
        {entries.map(([kind, count]) => (
          <Row key={kind} style={styles.legendItem}>
            <View
              style={[styles.legendDot, { backgroundColor: theme.kindColors[kind] ?? theme.colors.accent }]}
            />
            <Caption>
              {kindLabel(kind)} {count}
            </Caption>
          </Row>
        ))}
      </View>
    </Panel>
  );
}

function formatRelative(at: string): string {
  const hours = (Date.parse(at) - Date.now()) / 3_600_000;
  if (hours < 1) return 'within the hour';
  if (hours < 24) return `in ${Math.round(hours)}h`;
  return `in ${Math.round(hours / 24)}d`;
}

const createStyles = (theme: ResolvedTheme) => ({
  headerRow: {
    flexDirection: 'row' as const,
    alignItems: 'flex-start' as const,
    justifyContent: 'space-between' as const,
  },
  headerText: { gap: 2, flex: 1 },
  spaceBetween: { justifyContent: 'space-between' as const },
  tiles: { alignItems: 'flex-start' as const, marginTop: spacing.sm },
  emptyState: { gap: spacing.md },
  readinessPercent: { fontSize: typography.title, fontWeight: '700' as const },
  mixBar: {
    flexDirection: 'row' as const,
    borderRadius: theme.radius.pill,
    overflow: 'hidden' as const,
    marginTop: spacing.xs,
  },
  legend: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: spacing.md, marginTop: spacing.xs },
  legendItem: { gap: spacing.xs },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  actions: { gap: spacing.md },
  action: { flex: 1 },
});
