import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { previewIntervals, type CardWithEntry, type Rating } from '@language-srs/core';
import { useEngine } from '../src/engine/EngineProvider';
import { GradeButtons, ReviewCard, speakEntry } from '../src/components/ReviewCard';
import { BigButton, Caption, ProgressBar, Row, Screen, Title } from '../src/components/ui';
import { spacing, useThemedStyles, type ResolvedTheme } from '../src/theme';

/**
 * The review session.
 *
 * Nothing on this screen that is not the card, the progress through the session,
 * and the next thing to press. Running totals used to sit under the buttons and
 * competed with them for attention — the summary at the end is where they belong.
 */
export default function ReviewScreen() {
  const { engine, revision, grade } = useEngine();
  const styles = useThemedStyles(createStyles);
  const router = useRouter();
  const params = useLocalSearchParams<{ card?: string; reveal?: string; language?: string }>();

  const [revealed, setRevealed] = useState(params.reveal === '1');
  const [session, setSession] = useState({ reviewed: 0, recalled: 0 });
  const shownAt = useRef(Date.now());

  const queue = useMemo(() => {
    return engine.getQueue();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, revision]);

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
    if (current.card.kind === 'listening') {
      speakEntry(current.entry.target, current.entry.languageCode);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.card.id]);

  const onGrade = useCallback(
    async (rating: Rating) => {
      if (!current) return;

      if (Platform.OS !== 'web') {
        void Haptics.impactAsync(
          rating === 1 ? Haptics.ImpactFeedbackStyle.Heavy : Haptics.ImpactFeedbackStyle.Light,
        );
      }

      await grade(current.card.id, rating, {
        durationMs: Date.now() - shownAt.current,
        source: 'app',
      });

      setSession((previous) => ({
        reviewed: previous.reviewed + 1,
        recalled: previous.recalled + (rating > 1 ? 1 : 0),
      }));
      setRevealed(false);

      // Drop the pinned-card parameter so the queue resumes its own ordering.
      if (params.card) router.setParams({ card: undefined, reveal: undefined });
    },
    [current, grade, params.card, router],
  );

  if (!current || !previews) {
    const accuracy = session.reviewed > 0 ? Math.round((session.recalled / session.reviewed) * 100) : 0;

    return (
      <Screen>
        <View style={styles.done}>
          <Title>{session.reviewed > 0 ? 'Done 🎉' : 'Nothing waiting'}</Title>
          <Caption>
            {session.reviewed > 0
              ? `${session.reviewed} card${session.reviewed === 1 ? '' : 's'}, ${accuracy}% recalled.`
              : 'Come back when reviews are ready, or raise your daily new-card limit.'}
          </Caption>
        </View>
        <BigButton label="Back home" onPress={() => router.replace('/')} />
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
        <ReviewCard pair={current} revealed={revealed} onReveal={() => setRevealed(true)} />
      </View>

      <View style={styles.footer}>
        {revealed ? (
          <GradeButtons previews={previews} onGrade={onGrade} />
        ) : (
          <BigButton label="Reveal" onPress={() => setRevealed(true)} />
        )}
      </View>
    </Screen>
  );
}

const createStyles = (_theme: ResolvedTheme) => ({
  done: { gap: spacing.sm, paddingVertical: spacing.xxl, alignItems: 'center' as const },
  progress: { gap: spacing.sm, paddingHorizontal: spacing.xl, paddingBottom: spacing.lg },
  progressRow: { justifyContent: 'center' as const },
  cardArea: { flex: 1, justifyContent: 'center' as const, paddingHorizontal: spacing.xl },
  footer: { gap: spacing.md, paddingHorizontal: spacing.xl, paddingTop: spacing.lg },
});
