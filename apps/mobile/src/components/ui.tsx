import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { spacing, typography, useTheme, useThemedStyles, type ResolvedTheme } from '../theme';

/**
 * The shared primitives, all of them theme-driven.
 *
 * Nothing here holds a colour of its own. Every surface, border and label reads
 * from the active language's theme, which is what lets the same component tree
 * render as ink-on-dark for Mandarin and washi-on-light for Japanese without a
 * single conditional in a screen.
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
    paddingTop: insets.top + spacing.md,
    paddingBottom: insets.bottom + spacing.xl,
    paddingHorizontal: padded ? spacing.lg : 0,
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

export function Panel({
  children,
  style,
  onPress,
  accent,
}: {
  children: React.ReactNode;
  style?: ViewStyle;
  onPress?: () => void;
  /** Border colour override, for highlighting the selected item in a list. */
  accent?: string;
}) {
  const styles = useThemedStyles(createStyles);
  const accented = accent ? { borderColor: accent } : undefined;

  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [styles.panel, accented, style, pressed && styles.panelPressed]}
      >
        {children}
      </Pressable>
    );
  }

  return <View style={[styles.panel, accented, style]}>{children}</View>;
}

export function Heading({ children }: { children: React.ReactNode }) {
  const styles = useThemedStyles(createStyles);
  return <Text style={styles.heading}>{children}</Text>;
}

export function Title({ children }: { children: React.ReactNode }) {
  const styles = useThemedStyles(createStyles);
  return <Text style={styles.title}>{children}</Text>;
}

export function Body({ children, muted }: { children: React.ReactNode; muted?: boolean }) {
  const styles = useThemedStyles(createStyles);
  return <Text style={[styles.body, muted && styles.muted]}>{children}</Text>;
}

export function Caption({ children, muted = true }: { children: React.ReactNode; muted?: boolean }) {
  const styles = useThemedStyles(createStyles);
  return <Text style={[styles.caption, muted && styles.muted]}>{children}</Text>;
}

export function Chip({ label, color }: { label: string; color?: string }) {
  const theme = useTheme();
  const styles = useThemedStyles(createStyles);
  const tint = color ?? theme.colors.accent;

  return (
    <View style={[styles.chip, { borderColor: tint }]}>
      <Text style={[styles.chipLabel, { color: tint }]}>{label}</Text>
    </View>
  );
}

export function Button({
  label,
  onPress,
  tone = 'primary',
  disabled,
}: {
  label: string;
  onPress: () => void;
  tone?: 'primary' | 'ghost';
  disabled?: boolean;
}) {
  const theme = useTheme();
  const styles = useThemedStyles(createStyles);

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled: Boolean(disabled) }}
      style={({ pressed }) => [
        styles.button,
        tone === 'primary' ? styles.buttonPrimary : styles.buttonGhost,
        pressed && !disabled && styles.buttonPressed,
        disabled && styles.buttonDisabled,
      ]}
    >
      <Text
        style={[
          styles.buttonLabel,
          // Light themes need dark text on their accent; dark themes need light.
          { color: tone === 'ghost' ? theme.colors.textMuted : onAccentColor(theme) },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

/**
 * Readable text colour on top of the theme's accent.
 *
 * The four accents run from a light gold to a deep indigo, so a fixed white label
 * is unreadable on at least one of them. Picking by the accent's own luminance
 * keeps the primary button legible in every theme without a per-theme override.
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
  const clamped = Math.max(0, Math.min(1, value));

  return (
    <View style={styles.progressTrack}>
      <View
        style={[
          styles.progressFill,
          { width: `${clamped * 100}%`, backgroundColor: color ?? theme.colors.accent },
        ]}
      />
    </View>
  );
}

export function StatTile({
  label,
  value,
  hint,
  color,
}: {
  label: string;
  value: string;
  hint?: string;
  color?: string;
}) {
  const theme = useTheme();
  const styles = useThemedStyles(createStyles);

  return (
    <View style={styles.statTile}>
      <Text style={[styles.statValue, { color: color ?? theme.colors.text }]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
      {hint ? <Text style={styles.statHint}>{hint}</Text> : null}
    </View>
  );
}

export function Row({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  const styles = useThemedStyles(createStyles);
  return <View style={[styles.row, style]}>{children}</View>;
}

export function Divider() {
  const styles = useThemedStyles(createStyles);
  return <View style={styles.divider} />;
}

const createStyles = (theme: ResolvedTheme) => ({
  screen: { flex: 1, backgroundColor: theme.colors.background },
  fill: { flex: 1 },
  scrollContent: { gap: spacing.lg },
  panel: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.card,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  panelPressed: { backgroundColor: theme.colors.surfaceRaised },
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
  caption: { color: theme.colors.text, fontSize: typography.caption, lineHeight: 18 },
  muted: { color: theme.colors.textMuted },
  chip: {
    borderWidth: 1,
    borderRadius: theme.radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 3,
    alignSelf: 'flex-start' as const,
  },
  chipLabel: { fontSize: typography.micro, fontWeight: '700' as const, letterSpacing: 0.4 },
  button: {
    borderRadius: theme.radius.control,
    paddingVertical: spacing.md + 2,
    paddingHorizontal: spacing.lg,
    alignItems: 'center' as const,
  },
  buttonPrimary: { backgroundColor: theme.colors.accent },
  buttonGhost: { backgroundColor: 'transparent', borderWidth: 1, borderColor: theme.colors.border },
  buttonPressed: { opacity: 0.8 },
  buttonDisabled: { opacity: 0.4 },
  buttonLabel: { fontSize: typography.body, fontWeight: '600' as const },
  progressTrack: {
    height: 6,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.border,
    overflow: 'hidden' as const,
  },
  progressFill: { height: '100%' as const, borderRadius: theme.radius.pill },
  statTile: { flex: 1, gap: 2 },
  statValue: { fontSize: 26, fontWeight: '700' as const },
  statLabel: { color: theme.colors.textMuted, fontSize: typography.caption },
  statHint: { color: theme.colors.textFaint, fontSize: typography.micro },
  row: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: spacing.md },
  divider: { height: 1, backgroundColor: theme.colors.border },
});
