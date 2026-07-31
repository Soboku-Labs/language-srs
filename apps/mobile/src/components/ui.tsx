import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { spacing, typography, useTheme, useThemedStyles, type ResolvedTheme } from '../theme';
import { AnimatedFill, Press } from '../motion/components';

/**
 * The shared primitives.
 *
 * Two rules keep the screens from getting dense again:
 *
 * 1. **Whitespace before borders.** An earlier version boxed every group in a
 *    bordered panel, which turned each screen into a stack of six rectangles with
 *    no hierarchy — everything equally important is the same as nothing being
 *    important. Surfaces are now flat tints, and `Card` is reserved for the one
 *    thing on a screen you are meant to act on.
 * 2. **One primary action per screen.** Everything else is a quiet text link.
 *
 * Nothing here holds a colour of its own; all of it reads from the active
 * language's theme.
 */

/** Screen shell: themed background, safe area, and scrolling when content overflows. */
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

/**
 * A raised surface, for the one thing on a screen that matters.
 *
 * Borderless by default — a tint against the background is enough separation, and
 * outlines on every group are what made the old layout read as a form.
 */
export function Card({
  children,
  style,
  onPress,
  accent,
}: {
  children: React.ReactNode;
  style?: ViewStyle;
  onPress?: () => void;
  /** Tints the left edge, for the review card's kind colour. */
  accent?: string;
}) {
  const styles = useThemedStyles(createStyles);
  const accented = accent ? { borderLeftWidth: 3, borderLeftColor: accent } : undefined;

  if (onPress) {
    return (
      <Press onPress={onPress} style={[styles.card, accented, style]}>
        {children}
      </Press>
    );
  }

  return <View style={[styles.card, accented, style]}>{children}</View>;
}

/** A group of related content, separated by space rather than by a box. */
export function Section({
  title,
  children,
  action,
}: {
  title?: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  const styles = useThemedStyles(createStyles);

  return (
    <View style={styles.section}>
      {title || action ? (
        <View style={styles.sectionHeader}>
          {title ? <Text style={styles.sectionTitle}>{title}</Text> : <View />}
          {action}
        </View>
      ) : null}
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

export function Pill({ label, color }: { label: string; color?: string }) {
  const theme = useTheme();
  const styles = useThemedStyles(createStyles);
  const tint = color ?? theme.colors.accent;

  return (
    <View style={[styles.pill, { backgroundColor: `${tint}1F` }]}>
      <Text style={[styles.pillLabel, { color: tint }]}>{label}</Text>
    </View>
  );
}

/**
 * The primary action.
 *
 * Deliberately large and round. It is the only filled control on a screen, so
 * "what do I do here" never needs a second look.
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
      <Text style={[styles.bigButtonLabel, { color: onAccentColor(theme) }]}>{label}</Text>
      {hint ? (
        <Text style={[styles.bigButtonHint, { color: onAccentColor(theme) }]}>{hint}</Text>
      ) : null}
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

/**
 * Readable text colour on top of the theme's accent.
 *
 * The four accents run from a light gold to a deep indigo, so a fixed white label
 * is unreadable on at least one of them.
 */
function onAccentColor(theme: ResolvedTheme): string {
  return luminance(theme.colors.accent) > 0.5 ? '#12100E' : '#FFFFFF';
}

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((offset) => {
    const value = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
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

/**
 * One number and its label, inline.
 *
 * Replaces the old tile-in-a-panel: three of these on a row read as a sentence
 * about your progress, where three bordered tiles read as a dashboard.
 */
export function Stat({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color?: string;
}) {
  const theme = useTheme();
  const styles = useThemedStyles(createStyles);

  return (
    <View style={styles.stat}>
      <Text style={[styles.statValue, { color: color ?? theme.colors.text }]}>{value}</Text>
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
  screen: { flex: 1, backgroundColor: theme.colors.background },
  fill: { flex: 1 },
  scrollContent: { gap: spacing.xl },

  card: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.card,
    padding: spacing.lg,
    gap: spacing.md,
  },
  pressed: { opacity: 0.75 },
  faded: { opacity: 0.4 },

  section: { gap: spacing.md },
  sectionHeader: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
  },
  sectionTitle: {
    color: theme.colors.textMuted,
    fontSize: typography.micro,
    fontWeight: '700' as const,
    letterSpacing: 1.2,
    textTransform: 'uppercase' as const,
  },

  title: {
    color: theme.colors.text,
    fontSize: typography.title,
    fontWeight: theme.headingWeight,
    letterSpacing: theme.headingLetterSpacing,
  },
  heading: {
    color: theme.colors.text,
    fontSize: typography.heading,
    fontWeight: theme.headingWeight,
    letterSpacing: theme.headingLetterSpacing,
  },
  body: { color: theme.colors.text, fontSize: typography.body, lineHeight: 22 },
  caption: { color: theme.colors.text, fontSize: typography.caption, lineHeight: 19 },
  muted: { color: theme.colors.textMuted },

  pill: {
    borderRadius: theme.radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 4,
    alignSelf: 'flex-start' as const,
  },
  pillLabel: { fontSize: typography.micro, fontWeight: '700' as const, letterSpacing: 0.4 },

  bigButton: {
    backgroundColor: theme.colors.accent,
    borderRadius: theme.radius.pill,
    paddingVertical: spacing.lg + 2,
    paddingHorizontal: spacing.xl,
    alignItems: 'center' as const,
    gap: 2,
  },
  bigButtonLabel: { fontSize: typography.heading, fontWeight: '700' as const },
  bigButtonHint: { fontSize: typography.micro, opacity: 0.75 },

  textButton: { paddingVertical: spacing.sm, paddingHorizontal: 2 },
  textButtonLabel: { fontSize: typography.body, fontWeight: '600' as const },

  progressTrack: {
    height: 5,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.surfaceRaised,
    overflow: 'hidden' as const,
  },
  progressFill: { height: '100%' as const, borderRadius: theme.radius.pill },

  stat: { gap: 1 },
  statValue: { fontSize: 22, fontWeight: '700' as const },
  statLabel: { color: theme.colors.textMuted, fontSize: typography.micro },

  detailRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    paddingVertical: spacing.sm,
    gap: spacing.md,
  },
  detailLabel: { color: theme.colors.textMuted, fontSize: typography.caption, flex: 1 },
  detailValue: { color: theme.colors.text, fontSize: typography.caption, fontWeight: '600' as const },

  row: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: spacing.lg },
});
