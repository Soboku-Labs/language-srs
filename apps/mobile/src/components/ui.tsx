import React from 'react';
import { ScrollView, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { spacing, typography, useTheme, useThemedStyles, weight, type ResolvedTheme } from '../theme';
import { AnimatedFill, Press } from '../motion/components';

/**
 * The Suboku primitives.
 *
 * Three rules, each one a thing that had to be taken out rather than added:
 *
 * 1. **Space separates; lines almost never do.** An earlier version boxed every
 *    group in a bordered panel, which turned each screen into a stack of
 *    rectangles with no hierarchy. `Card` is now reserved for the single thing on
 *    a screen you act on, and even that is a tint rather than an outline.
 * 2. **One primary action per screen.** Everything else is text.
 * 3. **Colour carries information or it is removed.** Kind chips used to be
 *    colour-coded next to a text label that already said the same thing; the
 *    colour is gone and the label stayed.
 *
 * Nothing here holds a colour of its own — all of it reads from the resolved
 * palette, which is the system's neutrals plus the active language's one accent.
 */

/** Screen shell: canvas, safe area, and scrolling when content overflows. */
export function Screen({
  children,
  scroll = true,
  padded = true,
}: {
  children: React.ReactNode;
  scroll?: boolean;
  padded?: boolean;
}) {
  const insets = useSafeAreaInsets();
  const styles = useThemedStyles(createStyles);

  const inset: ViewStyle = {
    paddingTop: insets.top + spacing.lg,
    paddingBottom: insets.bottom + spacing.xl,
    paddingHorizontal: padded ? spacing.xl : 0,
  };

  if (!scroll) {
    return <View style={[styles.screen, inset, styles.fill]}>{children}</View>;
  }

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[inset, styles.scrollContent]}
      showsVerticalScrollIndicator={false}
    >
      {children}
    </ScrollView>
  );
}

/** A surface, for the one thing on a screen that matters. */
export function Card({
  children,
  style,
  onPress,
}: {
  children: React.ReactNode;
  style?: ViewStyle;
  onPress?: () => void;
}) {
  const styles = useThemedStyles(createStyles);

  if (onPress) {
    return (
      <Press onPress={onPress} style={[styles.card, style]}>
        {children}
      </Press>
    );
  }

  return <View style={[styles.card, style]}>{children}</View>;
}

/** A group of related content, separated by space rather than by a box. */
export function Section({ title, children }: { title?: string; children: React.ReactNode }) {
  const styles = useThemedStyles(createStyles);

  return (
    <View style={styles.section}>
      {title ? <Text style={styles.sectionTitle}>{title}</Text> : null}
      {children}
    </View>
  );
}

export function Title({ children }: { children: React.ReactNode }) {
  const styles = useThemedStyles(createStyles);
  return <Text style={styles.title}>{children}</Text>;
}

export function Heading({ children }: { children: React.ReactNode }) {
  const styles = useThemedStyles(createStyles);
  return <Text style={styles.heading}>{children}</Text>;
}

export function Body({ children, muted }: { children: React.ReactNode; muted?: boolean }) {
  const styles = useThemedStyles(createStyles);
  return <Text style={[styles.body, muted && styles.muted]}>{children}</Text>;
}

export function Caption({ children, muted = true }: { children: React.ReactNode; muted?: boolean }) {
  const styles = useThemedStyles(createStyles);
  return <Text style={[styles.caption, muted && styles.muted]}>{children}</Text>;
}

/**
 * A small label.
 *
 * Neutral by default. It takes a colour only where the colour means something the
 * text does not already say — which, in practice, is nowhere yet.
 */
export function Pill({ label, color }: { label: string; color?: string }) {
  const styles = useThemedStyles(createStyles);
  return (
    <View style={styles.pill}>
      <Text style={[styles.pillLabel, color ? { color } : undefined]}>{label}</Text>
    </View>
  );
}

/**
 * The primary action.
 *
 * Ink, not accent. A full-width slab of the language's accent was the loudest
 * element on every screen, and an accent that occupies a quarter of the canvas has
 * stopped being an accent. Filled ink is quieter, reads as more certain, and works
 * identically in both modes — which leaves the accent free to appear where it
 * actually distinguishes something: links, progress, tone marks, the language dot.
 */
export function BigButton({
  label,
  hint,
  onPress,
  disabled,
}: {
  label: string;
  hint?: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  const theme = useTheme();
  const styles = useThemedStyles(createStyles);

  return (
    <Press
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled: Boolean(disabled) }}
      style={[styles.bigButton, disabled && styles.faded]}
    >
      <Text style={[styles.bigButtonLabel, { color: theme.colors.canvas }]}>{label}</Text>
      {hint ? <Text style={[styles.bigButtonHint, { color: theme.colors.canvas }]}>{hint}</Text> : null}
    </Press>
  );
}

/** A quiet secondary action. Text and a tap target, no box. */
export function TextButton({
  label,
  onPress,
  color,
}: {
  label: string;
  onPress: () => void;
  color?: string;
}) {
  const theme = useTheme();
  const styles = useThemedStyles(createStyles);

  return (
    <Press onPress={onPress} accessibilityRole="button" style={styles.textButton}>
      <Text style={[styles.textButtonLabel, { color: color ?? theme.colors.accent }]}>{label}</Text>
    </Press>
  );
}

export function ProgressBar({ value, color }: { value: number; color?: string }) {
  const theme = useTheme();
  const styles = useThemedStyles(createStyles);

  return (
    <View style={styles.progressTrack}>
      <AnimatedFill value={value} color={color ?? theme.colors.accent} style={styles.progressFill} />
    </View>
  );
}

/** One number and its label. Three on a row read as a sentence about your progress. */
export function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  const theme = useTheme();
  const styles = useThemedStyles(createStyles);

  return (
    <View style={styles.stat}>
      <Text style={[styles.statValue, { color: color ?? theme.colors.ink }]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

/** A label and value on one line, for lists of facts. */
export function DetailRow({ label, value }: { label: string; value: string }) {
  const styles = useThemedStyles(createStyles);

  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue}>{value}</Text>
    </View>
  );
}

export function Row({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  const styles = useThemedStyles(createStyles);
  return <View style={[styles.row, style]}>{children}</View>;
}

const createStyles = (theme: ResolvedTheme) => ({
  screen: { flex: 1, backgroundColor: theme.colors.canvas },
  fill: { flex: 1 },
  scrollContent: { gap: spacing.xl },

  card: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.card,
    padding: spacing.lg,
    gap: spacing.md,
  },
  faded: { opacity: 0.4 },

  section: { gap: spacing.md },
  sectionTitle: {
    color: theme.colors.inkMuted,
    fontSize: typography.micro,
    fontWeight: weight.strong,
    letterSpacing: 0.8,
    textTransform: 'uppercase' as const,
  },

  title: { color: theme.colors.ink, fontSize: typography.title, fontWeight: weight.strong },
  heading: { color: theme.colors.ink, fontSize: typography.heading, fontWeight: weight.medium },
  body: { color: theme.colors.ink, fontSize: typography.body, lineHeight: 22 },
  caption: { color: theme.colors.ink, fontSize: typography.caption, lineHeight: 19 },
  muted: { color: theme.colors.inkMuted },

  pill: {
    borderRadius: theme.radius.control,
    backgroundColor: theme.colors.surfaceRaised,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: 3,
    alignSelf: 'flex-start' as const,
  },
  pillLabel: { color: theme.colors.inkMuted, fontSize: typography.micro, fontWeight: weight.medium },

  bigButton: {
    backgroundColor: theme.colors.ink,
    borderRadius: theme.radius.control,
    paddingVertical: spacing.md + 4,
    paddingHorizontal: spacing.xl,
    alignItems: 'center' as const,
    gap: 2,
  },
  bigButtonLabel: { fontSize: typography.heading, fontWeight: weight.strong },
  bigButtonHint: { fontSize: typography.micro, opacity: 0.7 },

  textButton: { paddingVertical: spacing.sm, paddingHorizontal: 2 },
  textButtonLabel: { fontSize: typography.body, fontWeight: weight.medium },

  progressTrack: {
    height: 3,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.surfaceRaised,
    overflow: 'hidden' as const,
  },
  progressFill: { height: '100%' as const, borderRadius: theme.radius.pill },

  stat: { gap: 2 },
  statValue: { fontSize: 21, fontWeight: weight.medium },
  statLabel: { color: theme.colors.inkMuted, fontSize: typography.micro },

  detailRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    paddingVertical: spacing.sm,
    gap: spacing.md,
  },
  detailLabel: { color: theme.colors.inkMuted, fontSize: typography.caption, flex: 1 },
  detailValue: { color: theme.colors.ink, fontSize: typography.caption, fontWeight: weight.medium },

  row: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: spacing.lg },
});
