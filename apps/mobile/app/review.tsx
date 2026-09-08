import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform, ScrollView, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  CARD_KINDS,
  STUDY_MODES,
  buildChoiceOptions,
  buildToneOptions,
  checkTypedAnswer,
  isAutoGraded,
  isTypingFeasible,
  previewIntervals,
  resolveAnswerMode,
  suggestRating,
  type AnswerAttempt,
  type AnswerMode,
  type AnswerOption,
  type CardKind,
  type CardWithEntry,
  type LexicalEntry,
  type Rating,
  type StudyMode,
} from '@language-srs/core';
import { useEngine } from '../src/engine/EngineProvider';
import { GradeButtons, ReviewCard, speakEntry } from '../src/components/ReviewCard';
import { ChoiceAnswer, TypedAnswer } from '../src/components/AnswerInput';
import { BigButton, Caption, ProgressBar, Row, Screen, TextButton, Title } from '../src/components/ui';
import { DealtCard, PopIn, Rise } from '../src/motion/components';
import { springBouncy } from '../src/motion/tokens';
import { spacing, typography, useTheme, useThemedStyles, weight, type ResolvedTheme } from '../src/theme';

/**
 * What the card says it wants, under the prompt.
 *
 * Tone cards already ask "Which tones?" on the face of the card, so they get
 * nothing here rather than asking twice.
 */
const ANSWER_PROMPTS: Partial<Record<AnswerMode, string>> = {
  choice: 'Pick the answer',
  typed: 'Type it',
};

/**
 * Why a session is empty, said in the mode's own terms.
 *
 * An empty cram session used to advise raising the daily new-card limit, which
 * has nothing to do with cramming and would not have helped.
 */
const EMPTY_COPY: Record<StudyMode, string> = {
  due: 'Come back when reviews are ready, or raise your daily new-card limit.',
  learn: 'No new words left at this level. Move up a level, or raise your daily new-card limit.',
  cram: 'Nothing to cram — you have not started any words at this level yet.',
};

/**
 * The review session.
 *
 * Cards are now answered rather than merely revealed. Which is not a flourish:
 * HSK, JLPT and TOPIK are almost entirely multiple choice, and a learner who has
 * only ever self-graded has never once practised picking the right option out of
 * four with three plausible ones beside it. Self-grading survives where it is
 * genuinely right — handwriting, and any card whose pool cannot yield real
 * distractors — and `resolveAnswerMode` decides which is which.
 *
 * Everything else on this screen is still the card, the progress through the
 * session, and the next thing to press. The session controls sit in one quiet row
 * beneath the action rather than competing with it.
 *
 * The one piece of motion that carries information: after a grade the next card
 * rises from beneath, offset in the direction of the grade you gave. Again leans
 * left, Easy leans right. That is the only signal distinguishing a grade you meant
 * from one you mis-tapped, and it arrives immediately rather than a card later.
 */
export default function ReviewScreen() {
  const { engine, revision, grade, mutate } = useEngine();
  const theme = useTheme();
  const styles = useThemedStyles(createStyles);
  const router = useRouter();
  const params = useLocalSearchParams<{
    card?: string;
    reveal?: string;
    language?: string;
    mode?: string;
    kind?: string;
  }>();

  const [revealed, setRevealed] = useState(params.reveal === '1');
  const [attempt, setAttempt] = useState<AnswerAttempt | undefined>();
  const [chosenId, setChosenId] = useState<string | undefined>();
  const [session, setSession] = useState({ reviewed: 0, recalled: 0 });
  const [missed, setMissed] = useState<LexicalEntry[]>([]);
  const [lastDirection, setLastDirection] = useState(0);
  /**
   * Session-level, not per-card. Someone who wants to type wants to type for the
   * whole sitting; asking again on every card would be the setting getting in the
   * way of the thing it configures.
   */
  const [preferTyped, setPreferTyped] = useState(false);

  const shownAt = useRef(Date.now());
  // Guards against a double-tap grading the same card twice: the queue does not
  // move until the await resolves and the revision bumps, so a second press
  // inside that window would land on the card that is already being graded.
  const grading = useRef(false);
  /**
   * What each grade in this sitting did to the counters, so undo can reverse it
   * exactly. Recomputing from the rating alone would be close but not right — it
   * cannot tell whether a word was already in the missed list when it was graded.
   */
  const history = useRef<{ rating: Rating; missedEntryId?: string }[]>([]);
  const missedIds = useRef(new Set<string>());

  /**
   * The session mode, from the link that opened this screen.
   *
   * Validated rather than cast: a deep link is external input, and an unrecognised
   * mode should quietly give the ordinary session rather than an empty one.
   */
  const sessionMode = STUDY_MODES.includes(params.mode as StudyMode) ? (params.mode as StudyMode) : 'due';
  const kinds = useMemo(
    () => (params.kind && CARD_KINDS.includes(params.kind as CardKind) ? [params.kind as CardKind] : undefined),
    [params.kind],
  );

  const queue = useMemo(() => {
    return engine.getQueue({ mode: sessionMode, ...(kinds ? { kinds } : {}) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, revision, sessionMode, kinds]);

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

  /** Distractor pool: every word the learner has for this language. */
  const pool = useMemo(() => {
    if (!current) return [];
    return engine.getEntries(current.card.languageCode);
  }, [engine, current]);

  const mode = useMemo(() => {
    if (!current) return 'self' as const;
    // A widget tap that already revealed the answer cannot then be asked as a
    // question — the learner has seen it. Self-grading is the honest mode there.
    if (params.reveal === '1' && params.card === current.card.id) return 'self' as const;
    return resolveAnswerMode(current.card, current.entry, pool, preferTyped ? 'typed' : undefined);
  }, [current, pool, preferTyped, params.reveal, params.card]);

  const options = useMemo(() => {
    if (!current) return [];
    if (mode === 'tone') return buildToneOptions({ card: current.card, entry: current.entry, pool });
    if (mode === 'choice') return buildChoiceOptions({ card: current.card, entry: current.entry, pool });
    return [];
  }, [current, mode, pool]);

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
    setChosenId(undefined);
    if (current.card.kind === 'listening') {
      speakEntry(current.entry.target, current.entry.languageCode);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.card.id]);

  const commitGrade = useCallback(
    async (rating: Rating) => {
      if (!current || grading.current) return;
      grading.current = true;

      // Haptic lands with the card leaving, not after the next one has rendered.
      if (Platform.OS !== 'web') {
        void Haptics.impactAsync(
          rating === 1 ? Haptics.ImpactFeedbackStyle.Heavy : Haptics.ImpactFeedbackStyle.Light,
        );
      }

      // Again leans left, Hard slightly left, Good and Easy right.
      setLastDirection(rating <= 2 ? -1 : 1);

      const entry = current.entry;
      await grade(current.card.id, rating, {
        durationMs: Date.now() - shownAt.current,
        source: 'app',
      });

      setSession((previous) => ({
        reviewed: previous.reviewed + 1,
        recalled: previous.recalled + (rating > 1 ? 1 : 0),
      }));

      // Decided against the state, not inside a functional update: the updater runs
      // later (and twice under StrictMode), so a flag set in there would not be
      // readable on the line below.
      const addedToMissed = rating === 1 && !missedIds.current.has(entry.id);
      if (addedToMissed) {
        missedIds.current.add(entry.id);
        setMissed((previous) => [...previous, entry]);
      }
      history.current.push({ rating, ...(addedToMissed ? { missedEntryId: entry.id } : {}) });

      setRevealed(false);
      setAttempt(undefined);
      setChosenId(undefined);

      // Drop the pinned-card parameter so the queue resumes its own ordering.
      if (params.card) router.setParams({ card: undefined, reveal: undefined });
      grading.current = false;
    },
    [current, grade, params.card, router],
  );

  /**
   * Record an answer without grading it.
   *
   * Nothing is committed here on purpose, including when the answer was wrong. The
   * learner has just been told they were wrong and the useful moment is the one
   * immediately after — seeing the right answer next to the option they took. That
   * moment is worth a deliberate tap to leave.
   */
  const settleAttempt = useCallback((next: AnswerAttempt) => {
    setAttempt(next);
    setRevealed(true);
    if (Platform.OS !== 'web') {
      void Haptics.notificationAsync(
        next.correct ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Warning,
      );
    }
  }, []);

  const onChoose = useCallback(
    (option: AnswerOption) => {
      if (attempt) return;
      setChosenId(option.id);
      settleAttempt({
        mode: mode === 'tone' ? 'tone' : 'choice',
        correct: option.correct,
        chosenOptionId: option.id,
        durationMs: Date.now() - shownAt.current,
      });
    },
    [attempt, mode, settleAttempt],
  );

  const onType = useCallback(
    (text: string) => {
      if (!current || attempt) return;
      const check = checkTypedAnswer(text, current.card, current.entry);
      settleAttempt({
        mode: 'typed',
        correct: check.correct,
        text,
        check,
        durationMs: Date.now() - shownAt.current,
      });
    },
    [attempt, current, settleAttempt],
  );

  const suggested = attempt?.correct ? suggestRating(attempt) : undefined;
  const settledWrong = attempt !== undefined && isAutoGraded(attempt);

  /**
   * Take back the last grade.
   *
   * The engine restores the card itself; this reverses what the session counted,
   * so the progress bar and the end-of-session summary do not quietly keep the
   * grade that was just withdrawn.
   */
  const onUndo = useCallback(async () => {
    const undone = await mutate((instance) => instance.undoLastGrade());
    if (!undone) return;

    const last = history.current.pop();
    setSession((previous) => ({
      reviewed: Math.max(0, previous.reviewed - 1),
      recalled: Math.max(0, previous.recalled - (last && last.rating > 1 ? 1 : 0)),
    }));
    if (last?.missedEntryId) {
      missedIds.current.delete(last.missedEntryId);
      setMissed((previous) => previous.filter((entry) => entry.id !== last.missedEntryId));
    }

    setLastDirection(0);
    setRevealed(false);
    setAttempt(undefined);
    setChosenId(undefined);
  }, [mutate]);

  const onBury = useCallback(async () => {
    if (!current) return;
    await mutate((instance) => instance.setCardBuried(current.card.id));
  }, [current, mutate]);

  const onSuspend = useCallback(async () => {
    if (!current) return;
    await mutate((instance) => instance.setCardSuspended(current.card.id, true));
  }, [current, mutate]);

  /**
   * Keyboard on web.
   *
   * The number keys mean the same thing in both phases — pick the nth thing in
   * front of you — because the options and the grade buttons are never on screen
   * asking for a number at the same time.
   */
  useEffect(() => {
    if (Platform.OS !== 'web' || !current) return;

    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      // Never steal keystrokes from the typed-answer field.
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;

      const digit = Number(event.key);
      if (digit >= 1 && digit <= 4) {
        if (!revealed && (mode === 'choice' || mode === 'tone')) {
          const option = options[digit - 1];
          if (option) {
            event.preventDefault();
            onChoose(option);
          }
          return;
        }
        if (revealed) {
          event.preventDefault();
          void commitGrade(digit as Rating);
        }
        return;
      }

      if (event.key === ' ' || event.key === 'Enter') {
        event.preventDefault();
        if (!revealed && mode === 'self') setRevealed(true);
        else if (settledWrong) void commitGrade(1);
        else if (revealed) void commitGrade(suggested ?? 3);
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [current, mode, options, revealed, settledWrong, suggested, onChoose, commitGrade]);

  if (!current || !previews) {
    const accuracy = session.reviewed > 0 ? Math.round((session.recalled / session.reviewed) * 100) : 0;

    return (
      <Screen>
        <PopIn style={styles.done} config={springBouncy}>
          <Title>{session.reviewed > 0 ? 'Done 🎉' : 'Nothing waiting'}</Title>
          <Caption>
            {session.reviewed > 0
              ? `${session.reviewed} card${session.reviewed === 1 ? '' : 's'}, ${accuracy}% recalled.`
              : EMPTY_COPY[sessionMode]}
          </Caption>
        </PopIn>

        {missed.length > 0 ? (
          <Rise index={1}>
            <View style={styles.missed}>
              <Text style={styles.missedTitle}>To come back to</Text>
              {missed.map((entry) => (
                <View key={entry.id} style={styles.missedRow}>
                  <Text style={styles.missedTarget}>{entry.target}</Text>
                  <Text style={styles.missedMeaning} numberOfLines={1}>
                    {entry.meanings.join(', ')}
                  </Text>
                </View>
              ))}
            </View>
          </Rise>
        ) : null}

        <Rise index={2}>
          <BigButton label="Back home" onPress={() => router.replace('/')} />
        </Rise>
      </Screen>
    );
  }

  const remaining = queue.cards.length;
  const total = remaining + session.reviewed;
  const typingFeasible = isTypingFeasible(current.card, current.entry);

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

      {/*
        Card and options are one block, scrolling together and centred when they
        fit. They were previously a centred card and a pinned footer, which on a
        tall screen opened a hand's width of nothing between the word and its
        options — and on a short one would have pushed the fourth option off the
        bottom with no way to reach it.
      */}
      <ScrollView
        style={styles.questionScroll}
        contentContainerStyle={styles.question}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <DealtCard cardKey={current.card.id} exitDirection={lastDirection}>
          <ReviewCard
            pair={current}
            revealed={revealed}
            {...(mode === 'self' ? { onReveal: () => setRevealed(true) } : {})}
            {...(ANSWER_PROMPTS[mode] ? { prompt: ANSWER_PROMPTS[mode] } : {})}
          />
        </DealtCard>

        {/*
          The options stay after answering, marked. Clearing them and showing only
          the right answer removes the one thing worth seeing: which distractor you
          fell for.
        */}
        {mode === 'choice' || mode === 'tone' ? (
          <ChoiceAnswer options={options} chosenId={chosenId} onChoose={onChoose} />
        ) : null}

        {mode === 'typed' ? (
          <TypedAnswer check={attempt?.check} onSubmit={onType} placeholder="Type your answer" />
        ) : null}
      </ScrollView>

      <View style={styles.footer}>
        {!revealed && mode === 'self' ? (
          <BigButton label="Reveal" onPress={() => setRevealed(true)} />
        ) : null}

        {revealed && settledWrong ? (
          <BigButton label="Got it" hint="Scheduled to come back soon" onPress={() => void commitGrade(1)} />
        ) : null}

        {revealed && !settledWrong ? (
          <GradeButtons previews={previews} onGrade={(rating) => void commitGrade(rating)} suggested={suggested} />
        ) : null}

        {/*
          Session controls, all in muted ink. They are deliberately the quietest
          thing on the screen: the accent belongs to the one action you came here
          to take, and four accent-coloured links under it would make "Suspend"
          look as inviting as answering.
        */}
        <Row style={styles.controls}>
          {engine.canUndo && session.reviewed > 0 ? (
            <TextButton label="Undo" color={theme.colors.inkMuted} onPress={() => void onUndo()} />
          ) : null}
          {!revealed && typingFeasible && mode !== 'typed' ? (
            <TextButton
              label="Type instead"
              color={theme.colors.inkMuted}
              onPress={() => setPreferTyped(true)}
            />
          ) : null}
          {!revealed && mode === 'typed' ? (
            <TextButton
              label="Show options"
              color={theme.colors.inkMuted}
              onPress={() => setPreferTyped(false)}
            />
          ) : null}
          <View style={styles.spacer} />
          <TextButton label="Bury" color={theme.colors.inkMuted} onPress={() => void onBury()} />
          <TextButton label="Suspend" color={theme.colors.inkMuted} onPress={() => void onSuspend()} />
        </Row>
      </View>
    </Screen>
  );
}

const createStyles = (theme: ResolvedTheme) => ({
  done: { gap: spacing.sm, paddingVertical: spacing.xxl, alignItems: 'center' as const },
  missed: { gap: spacing.sm },
  missedTitle: {
    color: theme.colors.inkMuted,
    fontSize: typography.micro,
    fontWeight: weight.strong,
    letterSpacing: 0.8,
    textTransform: 'uppercase' as const,
  },
  missedRow: {
    flexDirection: 'row' as const,
    alignItems: 'baseline' as const,
    justifyContent: 'space-between' as const,
    gap: spacing.md,
    paddingVertical: spacing.xs,
  },
  missedTarget: { color: theme.colors.ink, fontSize: typography.heading, fontWeight: weight.medium },
  missedMeaning: { color: theme.colors.inkMuted, fontSize: typography.caption, flexShrink: 1 },

  progress: { gap: spacing.sm, paddingHorizontal: spacing.xl, paddingBottom: spacing.lg },
  progressRow: { justifyContent: 'center' as const },
  questionScroll: { flex: 1 },
  question: {
    flexGrow: 1,
    justifyContent: 'center' as const,
    gap: spacing.lg,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
  },
  footer: { gap: spacing.md, paddingHorizontal: spacing.xl, paddingTop: spacing.lg },
  controls: { gap: spacing.md },
  spacer: { flex: 1 },
});
