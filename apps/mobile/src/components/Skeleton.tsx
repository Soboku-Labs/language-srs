import React, { useEffect } from 'react';
import { View, type DimensionValue, type ViewStyle } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { spacing, useTheme, useThemedStyles, type ResolvedTheme } from '../theme';

/**
 * The shape of something that has not arrived.
 *
 * The word lists come from the server now, so there is a moment on a device that
 * has never seen a level where the app knows the *layout* and not the content.
 * A skeleton is the honest thing to draw then: it says "two lines and a number
 * are coming, here", where a spinner in the middle of an empty screen says only
 * "wait".
 *
 * This is the one place the app breaks its own no-looping rule, and it earns it:
 * a pulse is what distinguishes "loading" from "empty and broken", and it stops
 * the moment the content lands. Under reduce-motion it does not pulse at all —
 * the grey blocks alone still carry the shape.
 */
const PULSE_MS = 900;

export function Skeleton({
  width = '100%',
  height = 14,
  radius,
  style,
}: {
  width?: DimensionValue;
  height?: number;
  radius?: number;
  style?: ViewStyle;
}) {
  const theme = useTheme();
  const reduced = useReducedMotion();
  const pulse = useSharedValue(reduced ? 0.6 : 0.35);

  useEffect(() => {
    if (reduced) return;
    pulse.value = withRepeat(
      withTiming(0.75, { duration: PULSE_MS, easing: Easing.inOut(Easing.quad) }),
      -1,
      true,
    );
  }, [pulse, reduced]);

  const animated = useAnimatedStyle(() => ({ opacity: pulse.value }));

  return (
    <Animated.View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        {
          width,
          height,
          borderRadius: radius ?? theme.radius.control,
          backgroundColor: theme.colors.surfaceRaised,
        },
        animated,
        style,
      ]}
    />
  );
}

/**
 * A small spinner in the language's own accent.
 *
 * Used where a skeleton would be too much furniture — inside a row that is
 * otherwise complete, waiting on one number. Drawn rather than
 * `ActivityIndicator` so it can take a colour on every platform, and so it is
 * the same size everywhere.
 */
export function Spinner({ color, size = 16 }: { color?: string; size?: number }) {
  const theme = useTheme();
  const reduced = useReducedMotion();
  const spin = useSharedValue(0);

  useEffect(() => {
    if (reduced) return;
    spin.value = withRepeat(withTiming(1, { duration: 900, easing: Easing.linear }), -1, false);
  }, [reduced, spin]);

  const animated = useAnimatedStyle(() => ({ transform: [{ rotate: `${spin.value * 360}deg` }] }));

  return (
    <Animated.View
      accessibilityElementsHidden
      style={[
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          borderWidth: 2,
          borderColor: `${color ?? theme.colors.accent}33`,
          borderTopColor: color ?? theme.colors.accent,
        },
        animated,
      ]}
    />
  );
}

/**
 * The landing page's language row, before its words are known.
 *
 * Deliberately the same geometry as the real row — art strip, portrait, three
 * lines — so nothing jumps when the content replaces it. A skeleton that is not
 * the size of what it stands in for is just a different kind of flicker.
 */
export function LanguageRowSkeleton({ accent }: { accent: string }) {
  const styles = useThemedStyles(createStyles);

  return (
    <View style={styles.row}>
      <View style={[styles.art, { backgroundColor: `${accent}0A` }]}>
        <Spinner color={accent} size={20} />
      </View>

      <View style={styles.body}>
        <Skeleton width={64} height={64} radius={32} />
        <View style={styles.text}>
          <Skeleton width="55%" height={18} />
          <Skeleton width="35%" height={12} />
          <Skeleton width="90%" height={12} />
          <Skeleton width="70%" height={12} />
        </View>
      </View>
    </View>
  );
}

/** The dashboard's count and its context, before the level has landed. */
export function CountSkeleton() {
  const styles = useThemedStyles(createStyles);

  return (
    <View style={styles.hero}>
      <Skeleton width={120} height={72} radius={12} />
      <Skeleton width={140} height={16} />
      <Skeleton width={160} height={6} radius={999} />
    </View>
  );
}

const createStyles = (theme: ResolvedTheme) => ({
  row: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.card,
    overflow: 'hidden' as const,
  },
  art: { height: 104, alignItems: 'center' as const, justifyContent: 'center' as const },
  body: { flexDirection: 'row' as const, gap: spacing.lg, alignItems: 'flex-start' as const, padding: spacing.lg },
  text: { flex: 1, gap: spacing.sm, paddingTop: spacing.xs },
  hero: { alignItems: 'center' as const, gap: spacing.md, paddingTop: spacing.md },
});
