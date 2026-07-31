import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  addGradeToSession,
  finishStudySession,
  getTeacher,
  previewIntervals,
  startStudySession,
  studySessionId,
  teacherLine,
  type CardWithEntry,
  type Rating,
  type StudySessionDraft,
} from '@language-srs/core';
import { useAuth } from '../src/auth/AuthProvider';
import { useEngine } from '../src/engine/EngineProvider';
import { GradeButtons, ReviewCard, speakEntry } from '../src/components/ReviewCard';
import type { AttemptResult } from '../src/components/Practice';
import { TeacherNote, TeacherSays } from '../src/components/Teacher';
import { BigButton, Caption, ProgressBar, Row, Screen, Title } from '../src/components/ui';
import { DealtCard, PopIn, Rise } from '../src/motion/components';
import { springBouncy } from '../src/motion/tokens';
import { spacing, useThemedStyles, type ResolvedTheme } from '../src/theme';

/**
 * The review session.
 *
 * Nothing on this screen that is not the card, the progress through the session,
 * and the next thing to press. Running totals used to sit under the buttons and
 * competed with them for attention — the summary at the end is where they belong.
 *
 * Two things carry information rather than decoration. After a grade the next
 * card rises from beneath, offset in the direction of the grade you gave: Again
 * leans left, Easy leans right, which is the only signal distinguishing a grade
 * you meant from one you mis-tapped. And the teacher answers the card you just
 * finished — one line, in the footer, where a running tally used to be.
 */
export default function ReviewScreen() {
  const { engine, revision, grade, mutate } = useEngine();
  const { deviceName } = useAuth();
  const styles = useThemedStyles(createStyles);
  const router = useRouter();
  const params = useLocalSearchParams<{ card?: string; reveal?: string; language?: string }>();

  const [revealed, setRevealed] = useState(params.reveal === '1');
  const [session, setSession] = useState({ reviewed: 0, recalled: 0 });
  const [lastDirection, setLastDirection] = useState(0);
  const [attempt, setAttempt] = useState<AttemptResult | undefined>();
  /** The teacher's response to the card just graded, or nothing at the start. */
  const [reaction, setReaction] = useState<string | undefined>();
  const shownAt = useRef(Date.now());

  const queue = useMemo(() => {
    return engine.getQueue();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, revision]);

  const teacher = getTeacher(engine.activeLanguage);

  /**
   * The sitting.
   *
   * Held in a ref rather than in state: it is written on every grade and read
   * only when the session ends, so putting it in state would re-render the card
   * for a number nothing on screen is showing.
   *
   * Recorded when the queue runs out or when the screen goes away — a session
   * abandoned halfway is still a session that happened, and dropping it would
   * make the history quietly under-report exactly the days somebody was busy.
   */
  const sitting = useRef<StudySessionDraft | undefined>(undefined);
  sitting.current ??= startStudySession({
    languageCode: engine.activeLanguage,
    now: engine.now(),
    id: studySessionId(),
    device: deviceName,
  });
  const recorded = useRef(false);

  const closeSitting = useCallback(async () => {
    if (recorded.current || !sitting.current) return;
    const finished = finishStudySession(sitting.current, engine.now());
    recorded.current = true;
    if (!finished) return;
    await mutate((instance) => instance.recordStudySession(finished));
  }, [engine, mutate]);

  /**
   * Close the sitting when the screen goes away.
   *
   * `closeSitting` is held in a ref and the effect has no dependencies, and that
   * is load-bearing rather than a style choice. `mutate` is rebuilt on every
   * state change, so a dependency on the callback re-runs this effect after each
   * grade — and an effect's cleanup running is indistinguishable from the screen
   * closing. That recorded a one-card sitting on the first grade and silently
   * dropped the rest of the session.
   */
  const closeRef = useRef(closeSitting);
  closeRef.current = closeSitting;

  useEffect(() => {
    return () => {
      void closeRef.current();
    };
  }, []);

  /**
   * The card on screen.
   *
   * A `card` parameter from a widget tap pins that specific card to the front, so
   * the card the learner saw on their home screen is the card they get — rather
   * than whatever the queue happens to rank first by the time the app opens.
   */
  const current: CardWithEntry | undefined = useMemo(() => {
    if (params.card) {
      const pinned = queue.cards.find((pair) => pair.card.id === params.card);
      if (pinned) return pinned;
    }
    return queue.cards[0];
  }, [queue, params.card]);

  const previews = useMemo(() => {
    if (!current) return undefined;
    const profile = engine.getProfile(current.card.languageCode);
    return previewIntervals(current.card, {
      now: engine.now(),
      config: { desiredRetention: profile.desiredRetention },
      ...(profile.examDate ? { examDate: profile.examDate } : {}),
    });
  }, [current, engine]);

  // Listening cards lead with audio, so play on arrival rather than making the
  // learner hunt for the button.
  useEffect(() => {
    if (!current) return;
    shownAt.current = Date.now();
    setRevealed(params.reveal === '1');
    setAttempt(undefined);
    if (current.card.kind === 'listening') {
      speakEntry(current.entry.target, current.entry.languageCode);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.card.id]);

  /**
   * An answer on a card that can be checked.
   *
   * Answering reveals immediately: the learner has committed, and making them
   * press Reveal afterwards only delays the feedback they just asked for.
   */
  const onAttempt = useCallback((result: AttemptResult) => {
    setAttempt(result);
    setRevealed(true);
  }, []);

  const onGrade = useCallback(
    async (rating: Rating) => {
      if (!current) return;

      // Haptic lands with the card leaving, not after the next one has rendered.
      if (Platform.OS !== 'web') {
        void Haptics.impactAsync(
          rating === 1 ? Haptics.ImpactFeedbackStyle.Heavy : Haptics.ImpactFeedbackStyle.Light,
        );
      }

      // Again leans left, Hard slightly left, Good and Easy right.
      setLastDirection(rating <= 2 ? -1 : 1);
      if (sitting.current) {
        sitting.current = addGradeToSession(sitting.current, rating, Date.now() - shownAt.current);
      }
      // Seeded on the card so the line is fixed for the moment it describes.
      setReaction(teacherLine(teacher, rating > 2 ? 'recalled' : 'lapsed', current.card.id));

      await grade(current.card.id, rating, {
        durationMs: Date.now() - shownAt.current,
        source: 'app',
      });

      setSession((previous) => ({
        reviewed: previous.reviewed + 1,
        recalled: previous.recalled + (rating > 1 ? 1 : 0),
      }));
      setRevealed(false);
      setAttempt(undefined);

      // Drop the pinned-card parameter so the queue resumes its own ordering.
      if (params.card) router.setParams({ card: undefined, reveal: undefined });
    },
    [current, grade, params.card, router, teacher],
  );

  // The queue emptying is the natural end of a sitting, so record it there
  // rather than waiting for the learner to navigate away — the account screen
  // and the sync push should both see it while the summary is still on screen.
  useEffect(() => {
    if (!current) void closeSitting();
  }, [current, closeSitting]);

  if (!current || !previews) {
    const accuracy = session.reviewed > 0 ? Math.round((session.recalled / session.reviewed) * 100) : 0;

    return (
      <Screen>
        <PopIn style={styles.done} config={springBouncy}>
          <Title>{session.reviewed > 0 ? 'Session done' : 'Nothing waiting'}</Title>
          <Caption>
            {session.reviewed > 0
              ? `${session.reviewed} card${session.reviewed === 1 ? '' : 's'}, ${accuracy}% recalled.`
              : 'Come back when reviews are ready, or raise your daily new-card limit.'}
          </Caption>
        </PopIn>
        <Rise index={1}>
          <TeacherSays
            teacher={teacher}
            line={teacherLine(teacher, session.reviewed > 0 ? 'finished' : 'idle', session.reviewed)}
          />
        </Rise>
        <Rise index={2}>
          {/* Pop back to the dashboard that pushed this session rather than
              replacing it, which would leave two dashboards in the stack. A
              session entered from a widget tap has nothing to pop to. */}
          <BigButton
            label="Back home"
            onPress={() => (router.canGoBack() ? router.back() : router.replace('/home'))}
          />
        </Rise>
      </Screen>
    );
  }

  const remaining = queue.cards.length;
  const total = remaining + session.reviewed;

  return (
    <Screen scroll={false} padded={false}>
      <View style={styles.progress}>
        <Row style={styles.progressRow}>
          <Caption>
            {session.reviewed + 1} of {total}
          </Caption>
        </Row>
        <ProgressBar value={total > 0 ? session.reviewed / total : 0} />
      </View>

      <View style={styles.cardArea}>
        <DealtCard cardKey={current.card.id} exitDirection={lastDirection}>
          <ReviewCard
            pair={current}
            revealed={revealed}
            onReveal={() => setRevealed(true)}
            onAttempt={onAttempt}
            {...(attempt ? { attempt } : {})}
          />
        </DealtCard>
      </View>

      <View style={styles.footer}>
        {reaction && !revealed ? (
          <View style={styles.reaction}>
            <TeacherNote align="center">{reaction}</TeacherNote>
          </View>
        ) : null}

        {revealed ? (
          <GradeButtons
            previews={previews}
            onGrade={onGrade}
            {...(attempt ? { suggested: suggestGrade(attempt) } : {})}
          />
        ) : (
          <BigButton label="Reveal" onPress={() => setRevealed(true)} />
        )}
      </View>
    </Screen>
  );
}

/**
 * The grade an answered card implies.
 *
 * Only ever a suggestion — see `GradeButtons`. Correct maps to Good rather than
 * Easy because getting a card right is the expected case, and Easy should mean
 * "this was trivial, stop showing it to me so often" rather than "correct".
 */
function suggestGrade(attempt: AttemptResult): Rating {
  if (attempt.verdict === 'correct') return 3;
  if (attempt.verdict === 'close') return 2;
  return 1;
}

const createStyles = (_theme: ResolvedTheme) => ({
  done: { gap: spacing.sm, paddingVertical: spacing.xxl, alignItems: 'center' as const },
  progress: { gap: spacing.sm, paddingHorizontal: spacing.xl, paddingBottom: spacing.lg },
  progressRow: { justifyContent: 'center' as const },
  cardArea: { flex: 1, justifyContent: 'center' as const, paddingHorizontal: spacing.xl },
  footer: { gap: spacing.md, paddingHorizontal: spacing.xl, paddingTop: spacing.lg },
  reaction: { paddingHorizontal: spacing.md },
});
