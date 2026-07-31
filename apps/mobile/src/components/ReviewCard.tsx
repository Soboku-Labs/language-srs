import React from 'react';
import { Platform, Pressable, Text, View } from 'react-native';
import * as Speech from 'expo-speech';
import {
  RATING_LABELS,
  describeTonePattern,
  kindLabel,
  type CardWithEntry,
  type IntervalPreview,
  type LanguageCode,
  type Rating,
} from '@language-srs/core';
import { spacing, typography, useTheme, useThemedStyles, type ResolvedTheme } from '../theme';
import { Press, Rise } from '../motion/components';
import { Caption, Card, Pill, Row } from './ui';
import { AttemptVerdict, ToneDrill, TypedAnswer, type AttemptResult } from './Practice';
import { ToneText } from './ToneText';

/** BCP-47 tags for platform text-to-speech, used by listening cards. */
const SPEECH_LOCALES: Record<LanguageCode, string> = {
  zh: 'zh-CN',
  ja: 'ja-JP',
  ko: 'ko-KR',
  vi: 'vi-VN',
};

export function speakEntry(text: string, languageCode: LanguageCode): void {
  Speech.stop();
  Speech.speak(text, { language: SPEECH_LOCALES[languageCode], rate: 0.85 });
}

/**
 * The flashcard.
 *
 * What goes on the front depends on the card kind, and the rules matter:
 *
 *  - `production` shows the English gloss and expects the target word, so the
 *    target must not appear until the answer is revealed. It is typed rather
 *    than self-graded, because deciding after the fact that you knew a word you
 *    could not produce is the easiest mistake in flashcards.
 *  - `listening` leads with audio. The written form is withheld, because a
 *    listening card that shows the word is a reading card.
 *  - `tone` shows the word and asks only for the tone pattern, tapped out on the
 *    language's own tones. The reading, which spells the tones out, stays hidden.
 *  - `reading` shows the example sentence with the target blanked out.
 */
export function ReviewCard({
  pair,
  revealed,
  onReveal,
  attempt,
  onAttempt,
}: {
  pair: CardWithEntry;
  revealed: boolean;
  onReveal: () => void;
  /** The learner's answer, once they have given one on an answerable card. */
  attempt?: AttemptResult;
  onAttempt: (result: AttemptResult) => void;
}) {
  const theme = useTheme();
  const styles = useThemedStyles(createStyles);
  const { card, entry } = pair;
  const accent = theme.kindColors[card.kind] ?? theme.colors.accent;

  return (
    <Card style={styles.card} accent={accent}>
      <Row style={styles.spaceBetween}>
        <Pill label={kindLabel(card.kind)} color={accent} />
        <Caption>{entry.partOfSpeech ?? ''}</Caption>
      </Row>

      {/* Tapping the body reveals — except on a card that is being answered,
          where a stray tap would throw the attempt away. */}
      <Pressable onPress={revealed || isAnswerable(pair) ? undefined : onReveal} style={styles.front}>
        <CardFront pair={pair} revealed={revealed} onAttempt={onAttempt} />
      </Pressable>

      {revealed ? (
        <Rise>
          <Answer pair={pair} attempt={attempt} />
        </Rise>
      ) : isAnswerable(pair) ? (
        // The exercise carries its own instruction; a second one under it would
        // be two things telling the learner what to do.
        null
      ) : (
        <View style={styles.centered}>
          <Caption>Tap to reveal</Caption>
        </View>
      )}
    </Card>
  );
}

/** Kinds that can be checked rather than only revealed. */
function isAnswerable({ card, entry }: CardWithEntry): boolean {
  if (card.kind === 'production') return true;
  return card.kind === 'tone' && (entry.tones?.length ?? 0) > 0;
}

function CardFront({
  pair,
  revealed,
  onAttempt,
}: {
  pair: CardWithEntry;
  revealed: boolean;
  onAttempt: (result: AttemptResult) => void;
}) {
  const theme = useTheme();
  const styles = useThemedStyles(createStyles);
  const { card, entry } = pair;

  switch (card.kind) {
    case 'production':
      return (
        <View style={styles.centered}>
          <Text style={styles.glossPrompt}>{entry.meanings.join(', ')}</Text>
          {revealed ? null : <TypedAnswer entry={entry} onAttempt={onAttempt} />}
        </View>
      );

    case 'listening':
      return (
        <View style={styles.centered}>
          <Pressable
            onPress={() => speakEntry(entry.target, entry.languageCode)}
            accessibilityRole="button"
            accessibilityLabel="Play audio"
            style={styles.speakButton}
          >
            <Text style={[styles.speakGlyph, { color: theme.colors.accent }]}>▶</Text>
          </Pressable>
          <Caption>Tap to hear it again</Caption>
          {revealed ? null : <Caption>What did you hear?</Caption>}
        </View>
      );

    case 'reading': {
      const example = entry.examples[0];
      if (!example) return <TargetText pair={pair} />;
      const blanked = example.target.split(entry.target).join('____');
      return <Text style={styles.sentencePrompt}>{blanked}</Text>;
    }

    case 'tone':
      return (
        <View style={styles.centered}>
          <Text style={styles.target}>{entry.target}</Text>
          {revealed ? <Caption>Which tones?</Caption> : <ToneDrill entry={entry} onAttempt={onAttempt} />}
        </View>
      );

    case 'writing':
      return (
        <View style={styles.centered}>
          <Text style={styles.glossPrompt}>{entry.meanings.join(', ')}</Text>
          <Caption>{entry.reading}</Caption>
          <Caption>Write it out, then reveal</Caption>
        </View>
      );

    case 'script':
      return <Text style={styles.target}>{entry.target}</Text>;

    default:
      return <TargetText pair={pair} />;
  }
}

function TargetText({ pair }: { pair: CardWithEntry }) {
  const { entry } = pair;
  return (
    <ToneText
      text={entry.target}
      tones={entry.tones}
      languageCode={entry.languageCode}
      size={entry.target.length > 6 ? typography.targetSmall : typography.target}
    />
  );
}

function Answer({ pair, attempt }: { pair: CardWithEntry; attempt?: AttemptResult }) {
  const theme = useTheme();
  const styles = useThemedStyles(createStyles);
  const { card, entry } = pair;
  const example = entry.examples[0];

  // Kinds whose front already shows the target do not repeat it in the answer.
  const frontShowedTarget = card.kind === 'recognition' || card.kind === 'tone' || card.kind === 'script';

  return (
    <View style={styles.answer}>
      {/* First, because on an answered card it is the thing being looked for. */}
      {attempt ? <AttemptVerdict attempt={attempt} /> : null}

      {frontShowedTarget ? null : (
        <ToneText
          text={entry.target}
          tones={entry.tones}
          languageCode={entry.languageCode}
          size={typography.targetSmall}
        />
      )}

      <Row style={styles.centeredRow}>
        <Text style={styles.reading}>{entry.reading}</Text>
        <Pressable
          onPress={() => speakEntry(entry.target, entry.languageCode)}
          accessibilityRole="button"
          accessibilityLabel="Play pronunciation"
        >
          <Text style={[styles.speakInline, { color: theme.colors.accent }]}>♪</Text>
        </Pressable>
      </Row>

      <Text style={styles.meaning}>{entry.meanings.join(', ')}</Text>

      {entry.tones && entry.tones.length > 0 ? (
        <View style={styles.centered}>
          <Row style={styles.toneLegend}>
            {entry.tones.map((tone, index) => (
              <View key={`${tone}-${index}`} style={[styles.tonePip, { backgroundColor: theme.toneColor(tone) }]}>
                <Text style={styles.tonePipLabel}>{tone}</Text>
              </View>
            ))}
          </Row>
          {/* The numbers are what the data stores; the names are what a teacher
              would actually say, and what the drill's buttons were labelled with. */}
          <Caption>{describeTonePattern(entry.languageCode, entry.tones)}</Caption>
        </View>
      ) : null}

      {entry.components && entry.components.length > 0 ? (
        <Caption>Components: {entry.components.join(' ')}</Caption>
      ) : null}

      {example ? (
        <View style={styles.example}>
          <Text style={styles.exampleTarget}>{example.target}</Text>
          {example.reading ? <Caption>{example.reading}</Caption> : null}
          <Caption>{example.translation}</Caption>
        </View>
      ) : null}

      {entry.mnemonic ? <Caption>{entry.mnemonic}</Caption> : null}
    </View>
  );
}

/**
 * The four grade buttons, each labelled with the interval it would produce.
 *
 * Showing the interval is not decoration — it is how a learner calibrates. "Good"
 * meaning 4 days and "Easy" meaning 11 days is the information that makes the
 * choice between them meaningful.
 *
 * `suggested` outlines the grade the check implies on an answered card. It is an
 * outline and not a preselection on purpose: the learner still presses the
 * button, because they know things the check does not — a typo, a word they
 * produced out loud before typing it wrong.
 */
export function GradeButtons({
  previews,
  onGrade,
  disabled,
  suggested,
}: {
  previews: Record<Rating, IntervalPreview>;
  onGrade: (rating: Rating) => void;
  disabled?: boolean;
  suggested?: Rating;
}) {
  const theme = useTheme();
  const styles = useThemedStyles(createStyles);
  const ratings: Rating[] = [1, 2, 3, 4];
  const gradeColors: Record<Rating, string> = {
    1: theme.colors.again,
    2: theme.colors.hard,
    3: theme.colors.good,
    4: theme.colors.easy,
  };

  return (
    <View style={styles.grades}>
      {ratings.map((rating) => (
        <Press
          key={rating}
          onPress={() => onGrade(rating)}
          disabled={disabled}
          accessibilityRole="button"
          accessibilityLabel={`${RATING_LABELS[rating]}, next in ${previews[rating].display}`}
          style={({ pressed }: { pressed: boolean }) => [
            styles.grade,
            { backgroundColor: `${gradeColors[rating]}22` },
            rating === suggested && { borderWidth: 1.5, borderColor: gradeColors[rating] },
            pressed && !disabled && { backgroundColor: `${gradeColors[rating]}44` },
            disabled && styles.gradeDisabled,
          ]}
        >
          <Text style={[styles.gradeLabel, { color: gradeColors[rating] }]}>{RATING_LABELS[rating]}</Text>
          <Text style={styles.gradeInterval}>{previews[rating].display}</Text>
        </Press>
      ))}
    </View>
  );
}

const createStyles = (theme: ResolvedTheme) => ({
  // Sized to its content rather than stretched to a fixed height: an empty card
  // with the prompt marooned in the middle reads as a loading state.
  card: { gap: spacing.md },
  spaceBetween: { justifyContent: 'space-between' as const },
  front: {
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    paddingVertical: spacing.lg,
    gap: spacing.md,
  },
  centered: { alignItems: 'center' as const, gap: spacing.sm },
  centeredRow: { justifyContent: 'center' as const },
  target: {
    color: theme.colors.text,
    fontSize: typography.target,
    fontWeight: '600' as const,
    textAlign: 'center' as const,
  },
  glossPrompt: {
    color: theme.colors.text,
    fontSize: typography.title,
    fontWeight: '600' as const,
    textAlign: 'center' as const,
  },
  sentencePrompt: {
    color: theme.colors.text,
    fontSize: typography.heading + 4,
    lineHeight: 34,
    textAlign: 'center' as const,
  },
  speakButton: {
    width: 64,
    height: 64,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.accentSoft,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  speakGlyph: { fontSize: 24 },
  speakInline: { fontSize: typography.heading },
  answer: { gap: spacing.sm, alignItems: 'center' as const },
  reading: { color: theme.colors.textMuted, fontSize: typography.heading },
  meaning: {
    color: theme.colors.text,
    fontSize: typography.heading,
    fontWeight: '600' as const,
    textAlign: 'center' as const,
  },
  toneLegend: { gap: spacing.xs, justifyContent: 'center' as const },
  tonePip: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  tonePipLabel: { color: '#FFFFFF', fontSize: typography.micro, fontWeight: '700' as const },
  example: {
    backgroundColor: theme.colors.surfaceRaised,
    borderRadius: theme.radius.control,
    padding: spacing.md,
    gap: 2,
    alignSelf: 'stretch' as const,
  },
  exampleTarget: { color: theme.colors.text, fontSize: typography.body + 2, lineHeight: 26 },
  grades: { flexDirection: 'row' as const, gap: spacing.sm },
  grade: {
    flex: 1,
    // Filled tints rather than outlines: four outlined boxes in a row read as a
    // form, four soft colour chips read as something to tap.
    borderRadius: theme.radius.pill,
    paddingVertical: spacing.md + 2,
    alignItems: 'center' as const,
    gap: 1,
    ...Platform.select({ web: { cursor: 'pointer' as const }, default: {} }),
  },
  gradeDisabled: { opacity: 0.4 },
  gradeLabel: { fontSize: typography.body, fontWeight: '700' as const },
  gradeInterval: { color: theme.colors.textFaint, fontSize: typography.micro },
});
