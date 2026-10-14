import React from 'react';
import { Platform, Pressable, Text, View } from 'react-native';
import * as Speech from 'expo-speech';
import {
  RATING_LABELS,
  kindLabel,
  type CardWithEntry,
  type IntervalPreview,
  type LanguageCode,
  type Rating,
} from '@mon/core';
import { spacing, typography, useTheme, useThemedStyles, weight, type ResolvedTheme } from '../theme';
import { Press, Rise } from '../motion/components';
import { Caption, Card, Pill, Row } from './ui';
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
 *    target must not appear until the answer is revealed.
 *  - `listening` leads with audio. The written form is withheld, because a
 *    listening card that shows the word is a reading card.
 *  - `tone` shows the word and asks only for the tone pattern, so the reading —
 *    which spells the tones out — stays hidden.
 *  - `reading` shows the example sentence with the target blanked out.
 *
 * The kind used to be colour-coded as well as named. The colour said nothing the
 * word next to it did not, so it went.
 */
export function ReviewCard({
  pair,
  revealed,
  onReveal,
  prompt,
}: {
  pair: CardWithEntry;
  revealed: boolean;
  /** Omitted when the card is answered rather than revealed — then there is nothing to tap. */
  onReveal?: () => void;
  /** What the question is asking for, when it is not simply "recall this". */
  prompt?: string;
}) {
  const styles = useThemedStyles(createStyles);
  const { card, entry } = pair;
  const hint = prompt ?? (onReveal ? 'Tap to reveal' : undefined);

  return (
    <Card style={styles.card}>
      <Row style={styles.spaceBetween}>
        <Pill label={kindLabel(card.kind)} />
        <Caption>{entry.partOfSpeech ?? ''}</Caption>
      </Row>

      <Pressable onPress={revealed ? undefined : onReveal} style={styles.front}>
        <CardFront pair={pair} revealed={revealed} />
      </Pressable>

      {revealed ? (
        <Rise>
          <Answer pair={pair} />
        </Rise>
      ) : hint ? (
        <View style={styles.centered}>
          <Caption>{hint}</Caption>
        </View>
      ) : null}
    </Card>
  );
}

function CardFront({ pair, revealed }: { pair: CardWithEntry; revealed: boolean }) {
  const theme = useTheme();
  const styles = useThemedStyles(createStyles);
  const { card, entry } = pair;

  switch (card.kind) {
    case 'production':
      return <Text style={styles.glossPrompt}>{entry.meanings.join(', ')}</Text>;

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
          {revealed ? <Caption>Tap to hear it again</Caption> : <Caption>What did you hear?</Caption>}
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
          <Caption>Which tones?</Caption>
        </View>
      );

    case 'writing':
      return (
        <View style={styles.centered}>
          <Text style={styles.glossPrompt}>{entry.meanings.join(', ')}</Text>
          <Caption>{entry.reading}</Caption>
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

function Answer({ pair }: { pair: CardWithEntry }) {
  const theme = useTheme();
  const styles = useThemedStyles(createStyles);
  const { card, entry } = pair;
  const example = entry.examples[0];

  // Kinds whose front already shows the target do not repeat it in the answer.
  const frontShowedTarget = card.kind === 'recognition' || card.kind === 'tone' || card.kind === 'script';

  return (
    <View style={styles.answer}>
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
        <Row style={styles.toneLegend}>
          {entry.tones.map((tone, index) => (
            <View key={`${tone}-${index}`} style={[styles.tonePip, { backgroundColor: theme.toneColor(tone) }]} />
          ))}
        </Row>
      ) : null}

      {example ? (
        <View style={styles.example}>
          <Text style={styles.exampleTarget}>{example.target}</Text>
          <Caption>{example.translation}</Caption>
        </View>
      ) : null}
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
 * These keep their colour: Again and Easy have to be distinguishable under a thumb
 * mid-session, without reading.
 *
 * `suggested` outlines one of them when the app has watched the answer land and has
 * an opinion about how it went. It is an outline rather than a fill because the
 * learner is still the one grading — the app can see that an answer took eleven
 * seconds, not whether that was hesitation or someone talking to them.
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
          accessibilityLabel={`${RATING_LABELS[rating]}, next in ${previews[rating].display}${
            rating === suggested ? ', suggested' : ''
          }`}
          style={[
            styles.grade,
            rating === suggested && { borderColor: gradeColors[rating], borderWidth: 1.5 },
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
  card: { gap: spacing.md },
  spaceBetween: { justifyContent: 'space-between' as const },
  front: {
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    paddingVertical: spacing.lg,
    gap: spacing.md,
  },
  centered: { alignItems: 'center' as const, gap: spacing.sm },
  centeredRow: { justifyContent: 'center' as const, gap: spacing.sm },
  target: {
    color: theme.colors.ink,
    fontSize: typography.target,
    fontWeight: weight.medium,
    textAlign: 'center' as const,
  },
  glossPrompt: {
    color: theme.colors.ink,
    fontSize: typography.title,
    fontWeight: weight.medium,
    textAlign: 'center' as const,
  },
  sentencePrompt: {
    color: theme.colors.ink,
    fontSize: typography.heading + 3,
    lineHeight: 32,
    textAlign: 'center' as const,
  },
  speakButton: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: theme.colors.accentSoft,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  speakGlyph: { fontSize: 20 },
  speakInline: { fontSize: typography.heading },
  answer: { gap: spacing.sm, alignItems: 'center' as const },
  reading: { color: theme.colors.inkMuted, fontSize: typography.heading },
  meaning: {
    color: theme.colors.ink,
    fontSize: typography.heading,
    fontWeight: weight.medium,
    textAlign: 'center' as const,
  },
  // Tone pips lost their numerals: the colour is the legend, and a digit inside a
  // 22pt circle was two encodings of one fact.
  toneLegend: { gap: spacing.xs, justifyContent: 'center' as const },
  tonePip: { width: 20, height: 3, borderRadius: 2 },
  example: {
    backgroundColor: theme.colors.surfaceRaised,
    borderRadius: theme.radius.control,
    padding: spacing.md,
    gap: 2,
    alignSelf: 'stretch' as const,
  },
  exampleTarget: { color: theme.colors.ink, fontSize: typography.body + 1, lineHeight: 25 },
  grades: { flexDirection: 'row' as const, gap: spacing.sm },
  grade: {
    flex: 1,
    borderRadius: theme.radius.control,
    backgroundColor: theme.colors.surface,
    paddingVertical: spacing.md + 2,
    alignItems: 'center' as const,
    gap: 1,
    ...Platform.select({ web: { cursor: 'pointer' as const }, default: {} }),
  },
  gradeDisabled: { opacity: 0.4 },
  gradeLabel: { fontSize: typography.caption, fontWeight: weight.strong },
  gradeInterval: { color: theme.colors.inkFaint, fontSize: typography.micro },
});
