import React, { useEffect, useRef, useState } from 'react';
import { Platform, Text, TextInput, View } from 'react-native';
import type { AnswerCheck, AnswerOption } from '@language-srs/core';
import { Press, Rise } from '../motion/components';
import { BigButton, Caption } from './ui';
import { spacing, typography, useTheme, useThemedStyles, weight, type ResolvedTheme } from '../theme';

/**
 * The answering controls.
 *
 * Kept separate from the card so the card stays a presentation of a word and this
 * stays the interaction. The two change for different reasons — the card changes
 * when the shape of a word changes, this changes when the shape of a question
 * does.
 */

/**
 * Multiple choice.
 *
 * Options stay on screen after answering, marked. Clearing them and showing only
 * the right answer removes the one thing worth seeing: which distractor you fell
 * for, and how close it was.
 */
export function ChoiceAnswer({
  options,
  chosenId,
  onChoose,
}: {
  options: AnswerOption[];
  chosenId?: string;
  onChoose: (option: AnswerOption) => void;
}) {
  const theme = useTheme();
  const styles = useThemedStyles(createStyles);
  const answered = chosenId !== undefined;

  return (
    <View style={styles.choices}>
      {options.map((option, index) => {
        const chosen = option.id === chosenId;
        // Once answered, the right option is always revealed — including when the
        // learner got it right, so the eye confirms rather than assumes.
        const showAsCorrect = answered && option.correct;
        const showAsWrong = answered && chosen && !option.correct;

        return (
          <Press
            key={option.id}
            onPress={() => !answered && onChoose(option)}
            disabled={answered}
            accessibilityRole="button"
            accessibilityState={{ selected: chosen, disabled: answered }}
            accessibilityLabel={`${index + 1}. ${option.label}`}
            style={[
              styles.choice,
              showAsCorrect && { backgroundColor: `${theme.colors.good}1F` },
              showAsWrong && { backgroundColor: `${theme.colors.again}1F` },
              answered && !showAsCorrect && !showAsWrong && styles.choiceDimmed,
            ]}
          >
            {/*
              One slot, two jobs. Before answering it is the index, which doubles as
              the keyboard shortcut on web. After answering it is the verdict, since
              the number keys now grade instead and a stale "3" would be a shortcut
              that no longer works.

              The verdict is a glyph rather than colour alone. The Mandarin tone ramp
              reuses the grade colours, so on an answered card the green of "correct"
              can sit beside the green of "third tone" — and red/green carries nothing
              at all for a red-green colour-blind reader.
            */}
            <Text
              style={[
                styles.choiceIndex,
                showAsCorrect && { color: theme.colors.good },
                showAsWrong && { color: theme.colors.again },
              ]}
            >
              {showAsCorrect ? '✓' : showAsWrong ? '✕' : answered ? '' : index + 1}
            </Text>
            <View style={styles.choiceText}>
              <Text
                style={[
                  styles.choiceLabel,
                  showAsCorrect && { color: theme.colors.good },
                  showAsWrong && { color: theme.colors.again },
                ]}
              >
                {option.label}
              </Text>
              {option.sublabel ? <Text style={styles.choiceSub}>{option.sublabel}</Text> : null}
            </View>
          </Press>
        );
      })}
    </View>
  );
}

/**
 * Typed answer.
 *
 * Submits on return so the keyboard never has to be dismissed to answer, and
 * autocorrect is off — a phone keyboard "helpfully" rewriting a half-learned word
 * would grade the phone rather than the learner.
 */
export function TypedAnswer({
  check,
  onSubmit,
  placeholder,
}: {
  check?: AnswerCheck;
  onSubmit: (text: string) => void;
  placeholder: string;
}) {
  const theme = useTheme();
  const styles = useThemedStyles(createStyles);
  const [text, setText] = useState('');
  const input = useRef<TextInput>(null);

  useEffect(() => {
    if (!check) setText('');
  }, [check]);

  if (check) {
    const tone =
      check.quality === 'exact'
        ? theme.colors.good
        : check.quality === 'close'
          ? theme.colors.hard
          : theme.colors.again;

    return (
      <Rise>
        <View style={styles.result}>
          <Text style={[styles.resultVerdict, { color: tone }]}>
            {check.quality === 'exact' ? 'Correct' : check.quality === 'close' ? 'So close' : 'Not quite'}
          </Text>
          {check.quality !== 'exact' ? <Text style={styles.resultExpected}>{check.expected}</Text> : null}
          {check.note ? <Caption>{check.note}</Caption> : null}
        </View>
      </Rise>
    );
  }

  return (
    <View style={styles.typed}>
      <TextInput
        ref={input}
        value={text}
        onChangeText={setText}
        onSubmitEditing={() => onSubmit(text)}
        placeholder={placeholder}
        placeholderTextColor={theme.colors.inkFaint}
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="off"
        spellCheck={false}
        returnKeyType="done"
        style={styles.input}
      />
      <BigButton label="Check" onPress={() => onSubmit(text)} disabled={text.trim().length === 0} />
    </View>
  );
}

/** Tone questions: whole patterns, laid out as a list like any other choice. */
export function ToneAnswer({
  options,
  chosenId,
  onChoose,
}: {
  options: AnswerOption[];
  chosenId?: string;
  onChoose: (option: AnswerOption) => void;
}) {
  return <ChoiceAnswer options={options} chosenId={chosenId} onChoose={onChoose} />;
}

const createStyles = (theme: ResolvedTheme) => ({
  choices: { gap: spacing.sm },
  choice: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: spacing.md,
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.control,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    ...Platform.select({ web: { cursor: 'pointer' as const }, default: {} }),
  },
  choiceDimmed: { opacity: 0.45 },
  choiceIndex: {
    color: theme.colors.inkFaint,
    fontSize: typography.caption,
    width: 14,
    textAlign: 'center' as const,
  },
  choiceText: { flex: 1, gap: 1 },
  choiceLabel: { color: theme.colors.ink, fontSize: typography.body, fontWeight: weight.medium },
  choiceSub: { color: theme.colors.inkMuted, fontSize: typography.micro },

  typed: { gap: spacing.md },
  input: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.control,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md + 2,
    color: theme.colors.ink,
    fontSize: typography.heading,
    textAlign: 'center' as const,
  },
  result: { alignItems: 'center' as const, gap: spacing.xs, paddingVertical: spacing.sm },
  resultVerdict: { fontSize: typography.body, fontWeight: weight.strong },
  resultExpected: { color: theme.colors.ink, fontSize: typography.title, fontWeight: weight.medium },
});
