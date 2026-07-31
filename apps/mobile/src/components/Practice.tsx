import React, { useState } from 'react';
import { Platform, Text, TextInput, View } from 'react-native';
import {
  checkTonePattern,
  checkWrittenAnswer,
  describeTonePattern,
  getToneSystem,
  type AnswerVerdict,
  type LexicalEntry,
} from '@language-srs/core';
import { spacing, typography, useTheme, useThemedStyles, type ResolvedTheme } from '../theme';
import { Press } from '../motion/components';
import { Caption } from './ui';

/**
 * The two cards you can actually answer.
 *
 * Everything else in the app is recall-then-self-grade, which is correct for a
 * flashcard and does nothing to catch the two mistakes that matter most in these
 * languages: producing the wrong written form, and producing the right word with
 * the wrong tone. Both of those are checkable, so both are checked.
 *
 * The check never grades. FSRS is driven by the learner's own judgement, and
 * "wrong, therefore Again" would mis-schedule every answer that was right but
 * mistyped. What the check does is reveal the card and put a specific sentence
 * under it — "right word, wrong marks" rather than a red cross.
 */

export interface AttemptResult {
  verdict: AnswerVerdict;
  /** One line describing what happened, shown under the answer. */
  message: string;
}

/**
 * The tone drill.
 *
 * A slot per syllable and one keypad. Tapping a tone fills the next empty slot;
 * tapping a filled slot clears it and everything after it, because a learner who
 * realises the first tone was wrong is not going to want to retype the rest in
 * the right order. Filling the last slot submits — there is no separate confirm
 * button, since the pattern is complete or it is not.
 */
export function ToneDrill({ entry, onAttempt }: { entry: LexicalEntry; onAttempt: (result: AttemptResult) => void }) {
  const theme = useTheme();
  const styles = useThemedStyles(createStyles);
  const [chosen, setChosen] = useState<number[]>([]);

  const tones = getToneSystem(entry.languageCode);
  const expected = entry.tones ?? [];
  if (tones.length === 0 || expected.length === 0) return null;

  const submit = (pattern: number[]) => {
    const result = checkTonePattern(entry, pattern);
    onAttempt({
      verdict: result.correct ? 'correct' : 'wrong',
      message: result.correct
        ? `${describeTonePattern(entry.languageCode, result.expected)} — exactly.`
        : `You tapped ${describeTonePattern(entry.languageCode, pattern)}. It is ${describeTonePattern(
            entry.languageCode,
            result.expected,
          )}.`,
    });
  };

  const choose = (tone: number) => {
    if (chosen.length >= expected.length) return;
    const next = [...chosen, tone];
    setChosen(next);
    if (next.length === expected.length) submit(next);
  };

  return (
    <View style={styles.drill}>
      <View style={styles.slots}>
        {expected.map((_, index) => {
          const value = chosen[index];
          const descriptor = tones.find((tone) => tone.value === value);
          return (
            <Press
              key={index}
              onPress={() => setChosen(chosen.slice(0, index))}
              disabled={value === undefined}
              accessibilityLabel={`Syllable ${index + 1}${descriptor ? `, ${descriptor.name}` : ', empty'}`}
              style={[
                styles.slot,
                value !== undefined && { backgroundColor: theme.toneColor(value), borderColor: 'transparent' },
              ]}
            >
              <Text style={[styles.slotLabel, value !== undefined && styles.slotLabelFilled]}>
                {descriptor?.mark ?? '·'}
              </Text>
            </Press>
          );
        })}
      </View>

      <View style={styles.keypad}>
        {tones.map((tone) => (
          <Press
            key={tone.value}
            onPress={() => choose(tone.value)}
            accessibilityRole="button"
            accessibilityLabel={`${tone.name}, ${tone.contour}`}
            style={[styles.key, { borderColor: theme.toneColor(tone.value) }]}
          >
            <Text style={[styles.keyMark, { color: theme.toneColor(tone.value) }]}>{tone.mark}</Text>
            <Text style={styles.keyName}>{tone.name}</Text>
          </Press>
        ))}
      </View>

      <Caption>Tap the tones in order. Tap a filled slot to go back.</Caption>
    </View>
  );
}

/**
 * The typed answer, for production cards.
 *
 * A production card asks you to produce the word, and self-grading a production
 * card is close to worthless — it is far too easy to look at the answer and
 * decide you knew it. Typing it first is the whole difference.
 *
 * Submitting an empty box is allowed and counts as wrong: giving up is an honest
 * answer, and pretending otherwise would only teach the learner to leave the
 * field blank and press Reveal instead.
 */
export function TypedAnswer({ entry, onAttempt }: { entry: LexicalEntry; onAttempt: (result: AttemptResult) => void }) {
  const theme = useTheme();
  const styles = useThemedStyles(createStyles);
  const [draft, setDraft] = useState('');

  const submit = () => {
    const result = checkWrittenAnswer(entry, draft);
    onAttempt({
      verdict: result.verdict,
      message:
        result.verdict === 'correct'
          ? 'Exactly right.'
          : (result.note ?? `You wrote “${draft.trim() || '—'}”. It is ${result.expected}.`),
    });
  };

  return (
    <View style={styles.typed}>
      <TextInput
        value={draft}
        onChangeText={setDraft}
        onSubmitEditing={submit}
        placeholder={`Write it in ${scriptHint(entry)}`}
        placeholderTextColor={theme.colors.textFaint}
        autoCapitalize="none"
        autoCorrect={false}
        // Autocomplete would answer the card for the learner.
        autoComplete="off"
        spellCheck={false}
        returnKeyType="done"
        accessibilityLabel="Your answer"
        style={styles.input}
      />
      <Press onPress={submit} accessibilityRole="button" style={styles.check}>
        <Text style={[styles.checkLabel, { color: theme.colors.accent }]}>Check</Text>
      </Press>
    </View>
  );
}

/** "the answer was ‘right word, wrong marks’" — shown under a revealed card. */
export function AttemptVerdict({ attempt }: { attempt: AttemptResult }) {
  const theme = useTheme();
  const styles = useThemedStyles(createStyles);

  const tint =
    attempt.verdict === 'correct'
      ? theme.colors.good
      : attempt.verdict === 'close'
        ? theme.colors.hard
        : theme.colors.again;

  return (
    <View style={[styles.verdict, { backgroundColor: `${tint}14` }]}>
      <Text style={[styles.verdictLabel, { color: tint }]}>
        {attempt.verdict === 'correct' ? 'Correct' : attempt.verdict === 'close' ? 'Close' : 'Not quite'}
      </Text>
      <Text style={styles.verdictMessage}>{attempt.message}</Text>
    </View>
  );
}

/** What the learner is being asked to type, in words rather than a script id. */
function scriptHint(entry: LexicalEntry): string {
  switch (entry.languageCode) {
    case 'zh':
      return 'characters';
    case 'ja':
      return 'kana or kanji';
    case 'ko':
      return 'hangul';
    default:
      return 'Vietnamese, with tone marks';
  }
}

const createStyles = (theme: ResolvedTheme) => ({
  drill: { gap: spacing.md, alignItems: 'center' as const, alignSelf: 'stretch' as const },
  slots: { flexDirection: 'row' as const, gap: spacing.sm },
  slot: {
    width: 44,
    height: 44,
    borderRadius: theme.radius.control,
    borderWidth: 1,
    borderColor: theme.colors.border,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  slotLabel: { color: theme.colors.textFaint, fontSize: typography.heading, fontWeight: '600' as const },
  slotLabelFilled: { color: '#FFFFFF' },

  keypad: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: spacing.sm, justifyContent: 'center' as const },
  key: {
    borderWidth: 1,
    borderRadius: theme.radius.control,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    alignItems: 'center' as const,
    minWidth: 62,
    gap: 1,
    ...Platform.select({ web: { cursor: 'pointer' as const }, default: {} }),
  },
  keyMark: { fontSize: typography.heading, fontWeight: '600' as const },
  keyName: { color: theme.colors.textMuted, fontSize: typography.micro },

  typed: { alignSelf: 'stretch' as const, gap: spacing.sm, alignItems: 'center' as const },
  input: {
    alignSelf: 'stretch' as const,
    backgroundColor: theme.colors.surfaceRaised,
    borderRadius: theme.radius.control,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    color: theme.colors.text,
    fontSize: typography.title,
    textAlign: 'center' as const,
  },
  check: { paddingVertical: spacing.sm, paddingHorizontal: spacing.lg },
  checkLabel: { fontSize: typography.body, fontWeight: '600' as const },

  verdict: {
    alignSelf: 'stretch' as const,
    borderRadius: theme.radius.control,
    padding: spacing.md,
    gap: 2,
  },
  verdictLabel: { fontSize: typography.micro, fontWeight: '700' as const, letterSpacing: 0.6, textTransform: 'uppercase' as const },
  verdictMessage: { color: theme.colors.text, fontSize: typography.caption, lineHeight: 19 },
});
