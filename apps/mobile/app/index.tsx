import React, { useMemo } from 'react';
import { Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import {
  LANGUAGE_CODES,
  getCulture,
  getExamTracksForLanguage,
  getLanguageProfile,
  getLanguageTheme,
  getLevelSizes,
  getTeacher,
  type LanguageCode,
} from '@language-srs/core';
import { useAuth } from '../src/auth/AuthProvider';
import { useEngine } from '../src/engine/EngineProvider';
import { Caption, Screen } from '../src/components/ui';
import { LanguageArt } from '../src/components/LanguageArt';
import { TeacherAvatar } from '../src/components/Teacher';
import { Press, Rise } from '../src/motion/components';
import { spacing, typography, useTheme, useThemedStyles, type ResolvedTheme } from '../src/theme';

/**
 * The landing page, and the app's front door.
 *
 * Every launch starts here rather than in the middle of whatever was last open.
 * That is the point of the rewrite: there is one place the app begins, it holds
 * the four languages and the four teachers, and everything else is reached from
 * it. A learner studying two languages switches by coming back to the front door
 * rather than by finding a picker buried behind the dashboard.
 *
 * It says three things and nothing else: what this is, how it teaches, and who
 * teaches it. The exam machinery, the readiness maths and the settings all live
 * past the door.
 */
export default function Landing() {
  const { engine, revision, setActiveLanguage } = useEngine();
  const { user } = useAuth();
  const styles = useThemedStyles(createStyles);
  const router = useRouter();

  const state = useMemo(() => {
    // Started means *reviewed*, not merely having a profile. The engine creates a
    // default Mandarin profile on first launch so there is something to schedule
    // against, and offering to "continue" a language nobody has opened yet would
    // greet a first-time visitor with somebody else's progress.
    const started = LANGUAGE_CODES.filter((code) => hasHistory(engine, code));
    const active = engine.activeLanguage;
    return {
      started: new Set(started),
      resume: started.includes(active) ? active : started[0],
      waiting: countWaiting(engine, active),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, revision]);

  const open = async (code: LanguageCode) => {
    await setActiveLanguage(code);
    router.push('/home');
  };

  return (
    <Screen>
      <Rise index={0} style={styles.masthead}>
        <View style={styles.topRow}>
          <Text style={styles.wordmark}>language·srs</Text>
          {/* One line, no chrome: signed out it is an offer, signed in it is a
              name and the way to the account. */}
          <Press onPress={() => router.push(user ? '/account' : '/sign-in')} accessibilityRole="button">
            <Text style={styles.accountLink}>{user ? user.displayName : 'Sign in'}</Text>
          </Press>
        </View>
        <Text style={styles.headline}>Four languages.{'\n'}Four teachers.</Text>
        <Text style={styles.standfirst}>
          Ten minutes a day of spaced repetition, shaped like the exam you are sitting. Choose a language and meet the
          person who takes you through it.
        </Text>
      </Rise>

      {state.resume ? (
        <Rise index={1}>
          <ResumeRow
            code={state.resume}
            waiting={countWaiting(engine, state.resume)}
            onPress={() => void open(state.resume!)}
          />
        </Rise>
      ) : null}

      <Rise index={2} style={styles.method}>
        <Text style={styles.sectionLabel}>How it is taught</Text>
        {TEACHING.map((item) => (
          <View key={item.title} style={styles.methodRow}>
            <Text style={styles.methodNumber}>{item.number}</Text>
            <View style={styles.methodText}>
              <Text style={styles.methodTitle}>{item.title}</Text>
              <Text style={styles.methodBody}>{item.body}</Text>
            </View>
          </View>
        ))}
      </Rise>

      <View style={styles.languages}>
        <Rise index={3}>
          <Text style={styles.sectionLabel}>Choose a language</Text>
        </Rise>
        {LANGUAGE_CODES.map((code, index) => (
          <Rise key={code} index={4 + index}>
            <LanguageRow code={code} started={state.started.has(code)} onPress={() => void open(code)} />
          </Rise>
        ))}
      </View>

      <Rise index={8}>
        <Caption>
          Your cards, history and schedule stay on this device unless you sign in, in which case they are kept in step
          across the devices you use and nowhere else. HSK publishes official word lists, so those targets are exact;
          JLPT, TOPIK and the Vietnamese framework do not, and the app labels those figures as estimates.
        </Caption>
      </Rise>
    </Screen>
  );
}

/**
 * One language and its teacher.
 *
 * Rendered in that language's accent rather than the active theme's, so the list
 * shows four people rather than one list recoloured four times. The method line
 * is the teacher's own — it is the thing that makes this a choice rather than a
 * menu of flags.
 */
function LanguageRow({ code, started, onPress }: { code: LanguageCode; started: boolean; onPress: () => void }) {
  const styles = useThemedStyles(createStyles);
  const language = getLanguageProfile(code);
  const teacher = getTeacher(code);
  const culture = getCulture(code);
  const accent = getLanguageTheme(code).colors.accent;
  const tracks = getExamTracksForLanguage(code).map((track) => track.name);
  const words = Object.values(getLevelSizes(code)).reduce((total, count) => total + count, 0);

  return (
    <Press onPress={onPress} accessibilityRole="button" style={styles.languageRow}>
      {/* The place, drawn in that language's own ink. It sits above the text
          rather than beside it because a strip of sky is what makes the row feel
          like somewhere rather than an option in a list. */}
      <View style={[styles.art, { backgroundColor: `${accent}0A` }]}>
        <LanguageArt code={code} width={320} height={104} />
      </View>

      <View style={styles.languageBody}>
        <TeacherAvatar teacher={teacher} size="large" />

        <View style={styles.languageText}>
          <View style={styles.languageTitleRow}>
            <Text style={styles.languageName}>{language.name}</Text>
            <Text style={styles.endonym}>{language.endonym}</Text>
          </View>
          <Text style={[styles.teacherName, { color: accent }]}>
            {culture.cityLocal} · {culture.countryLocal}
            {started ? ' · in progress' : ''}
          </Text>
          {/* Capped so four rows stay the same height; the full statement is the
              teacher's, but the list is a choice, not a reading exercise. */}
          <Text style={styles.methodLine} numberOfLines={3}>
            {teacher.method}
          </Text>
          <Text style={styles.tracks}>
            with {teacher.address} · {tracks.join(' / ')} · {words.toLocaleString()} words
          </Text>
        </View>
      </View>
    </Press>
  );
}

/** The one shortcut on the page: pick up where the last session left off. */
function ResumeRow({ code, waiting, onPress }: { code: LanguageCode; waiting: number; onPress: () => void }) {
  const styles = useThemedStyles(createStyles);
  const teacher = getTeacher(code);
  const accent = getLanguageTheme(code).colors.accent;

  return (
    <Press onPress={onPress} accessibilityRole="button" style={[styles.resume, { borderColor: accent }]}>
      <TeacherAvatar teacher={teacher} size="small" />
      <View style={styles.resumeText}>
        <Text style={styles.resumeTitle}>Continue with {teacher.address}</Text>
        <Text style={styles.resumeMeta}>
          {waiting > 0 ? `${waiting} card${waiting === 1 ? '' : 's'} waiting` : 'nothing due — study ahead'}
        </Text>
      </View>
      <Text style={[styles.chevron, { color: accent }]}>›</Text>
    </Press>
  );
}

/**
 * The teaching claim, in three lines.
 *
 * Deliberately about method rather than features: what a learner is agreeing to
 * when they tap a language, not a list of what the app contains.
 */
const TEACHING = [
  {
    number: '01',
    title: 'A teacher, not a word list',
    body: 'Each language is taught by someone with a position on how it should be learned — components before characters, kana before kanji, the ear before the page.',
  },
  {
    number: '02',
    title: 'Shaped like the paper',
    body: 'Sessions are weighted to match the exam you are sitting. A JLPT session contains no handwriting, because the JLPT has no writing section.',
  },
  {
    number: '03',
    title: 'Timed by forgetting',
    body: 'Every card comes back on the day before you would have lost it, and the schedule tightens on its own as an exam date approaches.',
  },
] as const;

type Engine = ReturnType<typeof useEngine>['engine'];

/** Cards a language has waiting right now, or zero if it has never been opened. */
function countWaiting(engine: Engine, code: LanguageCode): number {
  if (!engine.hasProfile(code)) return 0;
  const queue = engine.getQueue({ code });
  return queue.breakdown.due + queue.breakdown.fresh + queue.breakdown.learning;
}

/** Whether a single card of this language has ever been graded. */
function hasHistory(engine: Engine, code: LanguageCode): boolean {
  if (!engine.hasProfile(code)) return false;
  return engine.getAllCards(code).some((card) => card.reps > 0);
}

const createStyles = (theme: ResolvedTheme) => ({
  masthead: { gap: spacing.md, paddingTop: spacing.lg },
  topRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
  },
  accountLink: { color: theme.colors.accent, fontSize: typography.caption, fontWeight: '600' as const },
  wordmark: {
    color: theme.colors.textFaint,
    fontSize: typography.micro,
    fontWeight: '700' as const,
    letterSpacing: 2,
    textTransform: 'uppercase' as const,
  },
  headline: {
    color: theme.colors.text,
    fontSize: 38,
    lineHeight: 44,
    fontWeight: '600' as const,
    letterSpacing: -0.8,
  },
  standfirst: { color: theme.colors.textMuted, fontSize: typography.body, lineHeight: 23, maxWidth: 460 },

  sectionLabel: {
    color: theme.colors.textFaint,
    fontSize: typography.micro,
    fontWeight: '700' as const,
    letterSpacing: 1.2,
    textTransform: 'uppercase' as const,
  },

  method: { gap: spacing.lg },
  methodRow: { flexDirection: 'row' as const, gap: spacing.md },
  methodNumber: {
    color: theme.colors.textFaint,
    fontSize: typography.caption,
    fontWeight: '700' as const,
    width: 22,
    paddingTop: 2,
  },
  methodText: { flex: 1, gap: 2 },
  methodTitle: { color: theme.colors.text, fontSize: typography.body, fontWeight: '600' as const },
  methodBody: { color: theme.colors.textMuted, fontSize: typography.caption, lineHeight: 20 },

  languages: { gap: spacing.md },
  languageRow: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.card,
    overflow: 'hidden' as const,
  },
  art: { alignItems: 'center' as const, justifyContent: 'flex-end' as const },
  languageBody: {
    flexDirection: 'row' as const,
    gap: spacing.lg,
    alignItems: 'flex-start' as const,
    padding: spacing.lg,
  },
  languageText: { flex: 1, gap: 3 },
  languageTitleRow: { flexDirection: 'row' as const, alignItems: 'baseline' as const, gap: spacing.sm },
  languageName: { color: theme.colors.text, fontSize: typography.heading, fontWeight: '600' as const },
  endonym: { color: theme.colors.textFaint, fontSize: typography.caption },
  teacherName: { fontSize: typography.caption, fontWeight: '600' as const },
  methodLine: { color: theme.colors.textMuted, fontSize: typography.caption, lineHeight: 19 },
  tracks: { color: theme.colors.textFaint, fontSize: typography.micro, paddingTop: 2 },

  resume: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: spacing.md,
    borderWidth: 1,
    borderRadius: theme.radius.card,
    padding: spacing.md,
  },
  resumeText: { flex: 1, gap: 1 },
  resumeTitle: { color: theme.colors.text, fontSize: typography.body, fontWeight: '600' as const },
  resumeMeta: { color: theme.colors.textMuted, fontSize: typography.micro },
  chevron: { fontSize: 26 },
});
