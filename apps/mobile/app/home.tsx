import React, { useMemo } from 'react';
import { Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import {
  findExamLevel,
  getCulture,
  getLanguageProfile,
  getTeacher,
  kindLabel,
  teacherLine,
  type CardKind,
} from '@language-srs/core';
import { useEngine } from '../src/engine/EngineProvider';
import { BigButton, Caption, Row, Screen, Stat, TextButton, Title } from '../src/components/ui';
import { LanguageArt } from '../src/components/LanguageArt';
import { CountSkeleton } from '../src/components/Skeleton';
import { useVocabulary } from '../src/vocabulary/VocabularyProvider';
import { TeacherAvatar, TeacherNote } from '../src/components/Teacher';
import { CountUp, Press, Rise } from '../src/motion/components';
import { spacing, typography, useTheme, useThemedStyles, type ResolvedTheme } from '../src/theme';

/**
 * The dashboard.
 *
 * One question, answered immediately: is there anything to study, and how much.
 * Everything except the count, the button and a single row of context lives on
 * the Progress screen, one tap away.
 *
 * The header is now the teacher rather than a flag, and tapping it goes back to
 * the landing page — which is also where languages are switched. One door in,
 * one door out, and no picker hidden behind a chevron.
 */
export default function Dashboard() {
  const { engine, revision } = useEngine();
  const { loading: loadingLanguages } = useVocabulary();
  const theme = useTheme();
  const styles = useThemedStyles(createStyles);
  const router = useRouter();

  const view = useMemo(() => {
    const profile = engine.getProfile();
    return {
      profile,
      language: getLanguageProfile(profile.languageCode),
      teacher: getTeacher(profile.languageCode),
      culture: getCulture(profile.languageCode),
      level: findExamLevel(profile.targetLevelId),
      queue: engine.getQueue(),
      stats: engine.getStats(),
      readiness: engine.getReadiness(),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, revision]);

  const { profile, language, teacher, culture, level, queue, stats, readiness } = view;
  const waiting = queue.breakdown.due + queue.breakdown.fresh + queue.breakdown.learning;

  return (
    <Screen>
      {/* The teacher is the way back to the front door, and so to the other three.
          Popping rather than pushing when there is something to pop back to: the
          landing page is below this screen in the stack in every normal path
          through the app, and pushing a second copy of it stacks duplicates. */}
      <Rise index={0}>
        <Press
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
          style={styles.header}
          accessibilityRole="button"
          accessibilityLabel="Back to languages"
        >
          <Text style={styles.chevron}>‹</Text>
          <TeacherAvatar teacher={teacher} />
          <View style={styles.headerText}>
            <Title>{language.name}</Title>
            <Caption>
              {culture.cityLocal} · {level?.shortName}
              {profile.examDate ? ` · ${describeCountdown(readiness.daysToExam)}` : ''}
            </Caption>
          </View>
        </Press>
      </Rise>

      {/* The place this language is spoken, drawn once at the top of the day's
          work. It is the only decoration on the screen, and it earns its keep by
          being the reason most people are here. */}
      <Rise index={1} style={styles.artwork}>
        <LanguageArt code={profile.languageCode} width={320} height={110} />
      </Rise>

      {/* The count is the answer this screen exists to give, and until the
          level has arrived it would be the starter deck's answer rather than
          the syllabus's. A skeleton of the same size says "this number is
          coming" without showing a number that is about to change. */}
      <Rise index={2} style={styles.hero}>
        {loadingLanguages.has(profile.languageCode) ? (
          <CountSkeleton />
        ) : waiting > 0 ? (
          <>
            <CountUp value={waiting} style={styles.count} />
            <Text style={styles.countLabel}>{waiting === 1 ? 'card waiting' : 'cards waiting'}</Text>
            <MixBar mix={queue.kindMix} />
          </>
        ) : (
          <>
            <Text style={styles.count}>✓</Text>
            <Text style={styles.countLabel}>All caught up</Text>
            <Caption>
              {queue.nextDueAt
                ? `More lands ${formatRelative(queue.nextDueAt)}`
                : 'Raise your daily new-card limit to keep going'}
            </Caption>
          </>
        )}
      </Rise>

      {/* Seeded on the count so the line holds still while the screen re-renders,
          and changes when the situation it is describing actually changes. */}
      <Rise index={3} style={styles.teacherLine}>
        <TeacherNote align="center">{teacherLine(teacher, waiting > 0 ? 'greeting' : 'idle', waiting)}</TeacherNote>
      </Rise>

      <Rise index={4}>
        <BigButton
          label={waiting > 0 ? 'Study now' : 'Study ahead'}
          {...(waiting > 0 && queue.kindMix ? { hint: describeMix(queue.kindMix) } : {})}
          onPress={() => router.push('/review')}
        />
      </Rise>

      <Rise index={5}>
        <Row style={styles.stats}>
          {/* Studied-today is carried by the colour rather than by a badge: the
              streak is either lit or it is not. */}
          <Stat
            label="day streak"
            value={String(stats.streak.current)}
            color={stats.streak.studiedToday ? theme.colors.secondary : theme.colors.textMuted}
          />
          <Stat label="words known" value={String(stats.coverage.entriesKnown)} />
          <Stat
            label={profile.examDate ? 'exam ready' : 'syllabus'}
            value={`${Math.round((profile.examDate ? readiness.score : readiness.coverage) * 100)}%`}
          />
        </Row>
      </Rise>

      <Rise index={6}>
        <Row style={styles.links}>
          <TextButton label="Words" onPress={() => router.push('/words')} />
          <TextButton label="Progress" onPress={() => router.push('/stats')} />
          <TextButton label="Account" onPress={() => router.push('/account')} color={theme.colors.textMuted} />
          <TextButton label="Settings" onPress={() => router.push('/settings')} color={theme.colors.textMuted} />
        </Row>
      </Rise>
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
  header: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: spacing.md },
  headerText: { flex: 1, gap: 1 },
  // Leading, because it means back — a left-pointing chevron on the trailing
  // edge reads as "more", which is the opposite of what tapping this does.
  chevron: { color: theme.colors.textFaint, fontSize: 26, marginRight: -spacing.xs },

  artwork: { alignItems: 'center' as const, opacity: 0.9 },
  hero: { alignItems: 'center' as const, gap: spacing.xs, paddingTop: spacing.md },
  count: {
    color: theme.colors.accent,
    fontSize: 92,
    lineHeight: 100,
    fontWeight: '600' as const,
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

  teacherLine: { alignItems: 'center' as const, paddingBottom: spacing.md },
  stats: { justifyContent: 'space-between' as const, paddingHorizontal: spacing.sm },
  // Four links no longer fit on a narrow phone at the old spacing, and a row
  // that overflows silently loses the last one.
  links: { justifyContent: 'center' as const, flexWrap: 'wrap' as const, gap: spacing.md },
});
