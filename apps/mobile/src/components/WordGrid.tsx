import React from 'react';
import { Text, View } from 'react-native';
import type { LexicalEntry, WordBand, WordProgress } from '@language-srs/core';
import { Press } from '../motion/components';
import { spacing, typography, useTheme, useThemedStyles, type ResolvedTheme } from '../theme';

/**
 * Vocabulary as a field of colour.
 *
 * The list of words you are learning is the one screen where a table is the
 * wrong answer. Five hundred rows of target / reading / gloss / interval is a
 * spreadsheet, and nobody scans a spreadsheet to find out how they are doing —
 * they scan it to look one thing up, which is a different job the search field
 * already does.
 *
 * So the words are chips, laid out in reading order, tinted along a single
 * gradient from "just met" to "known". What that buys is the thing a table
 * cannot give: the *shape* of a level at a glance. A wall of pale chips with a
 * dark corner means you have started; a wall with red specks through it means
 * something specific is going wrong, and where.
 */

/**
 * Where a word's colour comes from.
 *
 * One ramp, three stops, borrowed from the grade buttons — red, amber, green —
 * because a learner has already been taught what those three mean by pressing
 * them. Inventing a second colour language for the same idea would mean
 * learning twice.
 *
 * Unseen words are not on the ramp at all. They are the paper colour with faint
 * text: absent rather than bad, which is what they are.
 */
export function strengthColor(theme: ResolvedTheme, word: WordProgress): string {
  if (word.band === 'unseen') return theme.colors.surfaceRaised;
  if (word.band === 'struggling') return theme.colors.again;

  const { again, hard, good } = theme.colors;
  return word.strength < 0.5
    ? mix(again, hard, word.strength * 2)
    : mix(hard, good, (word.strength - 0.5) * 2);
}

/**
 * The chip's fill: the ramp colour, heavily diluted into the page.
 *
 * A grid of fully saturated chips is a stained-glass window — striking, and
 * unreadable at the size where the target text has to be legible. The tint
 * deepens with strength, so the gradient survives dilution and the text stays
 * on the paper's contrast rather than on the ramp's.
 */
export function chipTint(theme: ResolvedTheme, word: WordProgress): string {
  if (word.band === 'unseen') return theme.colors.surfaceRaised;
  const alpha = Math.round(28 + word.strength * 52)
    .toString(16)
    .padStart(2, '0');
  return `${strengthColor(theme, word)}${alpha}`;
}

export const BAND_LABELS: Record<WordBand, string> = {
  unseen: 'not started',
  learning: 'learning',
  young: 'holding',
  mature: 'known',
  struggling: 'slipping',
};

/**
 * One word, closed or open.
 *
 * Closed it is the target text and nothing else — putting the reading and the
 * gloss in every chip would triple the height of the grid to carry information
 * nobody reads until they have picked a word.
 *
 * Open it takes the whole row and unfolds *in place*. The first version of this
 * put the detail in a panel under the grid, which is a panel five hundred chips
 * below the finger that asked for it: tapping a word appeared to do nothing.
 * Expanding where the word already is costs one reflow and no scrolling, and it
 * keeps the tint that prompted the tap next to the numbers that explain it.
 */
export function WordChip({
  entry,
  word,
  expanded,
  onPress,
}: {
  entry: LexicalEntry;
  word: WordProgress;
  expanded?: boolean;
  onPress?: () => void;
}) {
  const theme = useTheme();
  const styles = useThemedStyles(createStyles);

  const ramp = strengthColor(theme, word);
  const muted = word.band === 'unseen';

  if (expanded) {
    return (
      <Press
        onPress={onPress ?? (() => {})}
        accessibilityRole="button"
        accessibilityState={{ expanded: true }}
        accessibilityLabel={`${entry.target}, ${BAND_LABELS[word.band]}`}
        style={[styles.open, { backgroundColor: chipTint(theme, word), borderColor: ramp }]}
      >
        <View style={styles.openHead}>
          <Text style={styles.openTarget}>{entry.target}</Text>
          <Text style={styles.openReading}>{entry.reading}</Text>
          <Text style={[styles.openBand, { color: ramp }]}>{BAND_LABELS[word.band]}</Text>
        </View>

        <Text style={styles.openMeaning}>{entry.meanings.slice(0, 3).join(', ')}</Text>

        <View style={styles.openFacts}>
          <Fact label="holds for" value={describeStability(word.stabilityDays)} />
          <Fact
            label="recall now"
            value={word.band === 'unseen' ? '—' : `${Math.round(word.retrievability * 100)}%`}
          />
          <Fact label="cards" value={String(word.cards)} />
          <Fact
            label="lapses"
            value={String(word.lapses)}
            {...(word.lapses > 0 ? { color: theme.colors.again } : {})}
          />
        </View>

        {entry.examples[0] ? (
          <View style={styles.openExample}>
            <Text style={styles.openExampleTarget}>{entry.examples[0].target}</Text>
            <Text style={styles.openExampleGloss}>{entry.examples[0].translation}</Text>
          </View>
        ) : null}
      </Press>
    );
  }

  return (
    <Press
      onPress={onPress ?? (() => {})}
      accessibilityRole="button"
      accessibilityState={{ expanded: false }}
      accessibilityLabel={`${entry.target}, ${BAND_LABELS[word.band]}`}
      style={[styles.chip, { backgroundColor: chipTint(theme, word) }]}
    >
      <Text
        style={[styles.chipTarget, muted ? styles.chipTargetMuted : null]}
        numberOfLines={1}
      >
        {entry.target}
      </Text>
      {/* A word that keeps being lost gets a mark rather than a louder colour:
          at chip size, "very red" and "quite red" are the same red. */}
      {word.band === 'struggling' ? <View style={[styles.mark, { backgroundColor: ramp }]} /> : null}
    </Press>
  );
}

function Fact({ label, value, color }: { label: string; value: string; color?: string }) {
  const styles = useThemedStyles(createStyles);
  return (
    <View>
      <Text style={[styles.factValue, color ? { color } : null]}>{value}</Text>
      <Text style={styles.factLabel}>{label}</Text>
    </View>
  );
}

function describeStability(days: number): string {
  if (days <= 0) return 'not yet';
  if (days < 1) return `${Math.round(days * 24)}h`;
  if (days < 60) return `${Math.round(days)}d`;
  return `${Math.round(days / 30)}mo`;
}

/**
 * What the colours mean, as the colours themselves.
 *
 * A continuous ramp with the two ends named, rather than five swatches in a
 * row. The bands exist and the counts are shown elsewhere, but the gradient is
 * the thing being explained here and chopping it into boxes to explain it would
 * be explaining a different picture.
 */
export function StrengthLegend({ counts }: { counts?: { unseen: number; struggling: number } }) {
  const theme = useTheme();
  const styles = useThemedStyles(createStyles);

  const stops = [0, 0.25, 0.5, 0.75, 1].map((strength) =>
    strengthColor(theme, { band: 'learning', strength } as WordProgress),
  );

  return (
    <View style={styles.legend}>
      <View style={styles.legendBar}>
        {counts && counts.unseen > 0 ? (
          <View style={[styles.legendStop, { backgroundColor: theme.colors.surfaceRaised }]} />
        ) : null}
        {stops.map((color, index) => (
          <View key={index} style={[styles.legendStop, { backgroundColor: `${color}80` }]} />
        ))}
      </View>
      <View style={styles.legendLabels}>
        <Text style={styles.legendLabel}>{counts && counts.unseen > 0 ? 'not started' : 'just met'}</Text>
        <Text style={styles.legendLabel}>known</Text>
      </View>
    </View>
  );
}

/**
 * A level's composition as one bar.
 *
 * Used in the all-levels view, where there is room for a level per row and not
 * for a level's five hundred words. Same colours as the chips, so the two views
 * are obviously the same picture at two zooms.
 */
export function BandBar({ counts, total }: { counts: Record<WordBand, number>; total: number }) {
  const theme = useTheme();
  const styles = useThemedStyles(createStyles);

  const order: WordBand[] = ['mature', 'young', 'learning', 'struggling', 'unseen'];
  const colors: Record<WordBand, string> = {
    mature: theme.colors.good,
    young: `${theme.colors.good}80`,
    learning: theme.colors.hard,
    struggling: theme.colors.again,
    unseen: theme.colors.surfaceRaised,
  };

  if (total === 0) return <View style={styles.bandBar} />;

  return (
    <View style={styles.bandBar}>
      {order
        .filter((band) => counts[band] > 0)
        .map((band) => (
          <View key={band} style={{ flex: counts[band], backgroundColor: colors[band] }} />
        ))}
    </View>
  );
}

/** Linear blend of two `#rrggbb` colours. */
function mix(from: string, to: string, amount: number): string {
  const t = Math.max(0, Math.min(1, amount));
  const channels = [1, 3, 5].map((offset) => {
    const a = parseInt(from.slice(offset, offset + 2), 16);
    const b = parseInt(to.slice(offset, offset + 2), 16);
    return Math.round(a + (b - a) * t)
      .toString(16)
      .padStart(2, '0');
  });
  return `#${channels.join('')}`;
}

const createStyles = (theme: ResolvedTheme) => ({
  chip: {
    borderRadius: theme.radius.control,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    minWidth: 52,
    alignItems: 'center' as const,
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  chipTarget: { color: theme.colors.text, fontSize: typography.body + 2, fontWeight: '600' as const },
  chipTargetMuted: { color: theme.colors.textFaint, fontWeight: '400' as const },
  mark: {
    position: 'absolute' as const,
    top: 4,
    right: 4,
    width: 5,
    height: 5,
    borderRadius: 3,
  },

  // Full width, so the grid reflows around it rather than the chip growing into
  // its neighbours.
  open: {
    width: '100%' as const,
    borderRadius: theme.radius.card,
    borderWidth: 1.5,
    padding: spacing.lg,
    gap: spacing.md,
  },
  openHead: { flexDirection: 'row' as const, alignItems: 'baseline' as const, gap: spacing.md },
  openTarget: { color: theme.colors.text, fontSize: typography.targetSmall, fontWeight: '600' as const },
  openReading: { color: theme.colors.textMuted, fontSize: typography.body, flex: 1 },
  openBand: { fontSize: typography.micro, fontWeight: '700' as const, letterSpacing: 0.4 },
  openMeaning: { color: theme.colors.text, fontSize: typography.body, lineHeight: 21 },
  openFacts: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    flexWrap: 'wrap' as const,
    gap: spacing.md,
  },
  factValue: { color: theme.colors.text, fontSize: typography.body, fontWeight: '700' as const },
  factLabel: { color: theme.colors.textMuted, fontSize: typography.micro },
  openExample: {
    gap: 2,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    paddingTop: spacing.md,
  },
  openExampleTarget: { color: theme.colors.text, fontSize: typography.body },
  openExampleGloss: { color: theme.colors.textMuted, fontSize: typography.caption },

  legend: { gap: 4 },
  legendBar: {
    flexDirection: 'row' as const,
    height: 6,
    borderRadius: theme.radius.pill,
    overflow: 'hidden' as const,
  },
  legendStop: { flex: 1 },
  legendLabels: { flexDirection: 'row' as const, justifyContent: 'space-between' as const },
  legendLabel: { color: theme.colors.textFaint, fontSize: typography.micro },

  bandBar: {
    flexDirection: 'row' as const,
    height: 6,
    borderRadius: theme.radius.pill,
    overflow: 'hidden' as const,
    backgroundColor: theme.colors.surfaceRaised,
  },
});
