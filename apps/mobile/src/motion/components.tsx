import React, { useEffect, useRef, useState } from 'react';
import { Pressable, Text, type PressableProps, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import {
  PRESS_SCALE,
  RISE_DISTANCE,
  STAGGER_MS,
  duration,
  spring,
  springTight,
  timing,
} from './tokens';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/**
 * Content that rises into place.
 *
 * The app's entrance gesture: fade up over a short distance, staggered between
 * siblings so a screen resolves top to bottom in the order you would read it.
 * That ordering is the whole point — it tells you where to look first without
 * anything having to be bigger or brighter than it deserves.
 */
export function Rise({
  children,
  index = 0,
  style,
  distance = RISE_DISTANCE,
}: {
  children: React.ReactNode;
  /** Position in a staggered group. */
  index?: number;
  style?: StyleProp<ViewStyle>;
  distance?: number;
}) {
  const reduced = useReducedMotion();
  const progress = useSharedValue(reduced ? 1 : 0);

  useEffect(() => {
    if (reduced) {
      progress.value = 1;
      return;
    }
    progress.value = withDelay(index * STAGGER_MS, withTiming(1, timing(duration.base)));
  }, [index, progress, reduced]);

  const animated = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateY: (1 - progress.value) * distance }],
  }));

  return <Animated.View style={[style, animated]}>{children}</Animated.View>;
}

/**
 * A pressable that responds to touch by giving slightly.
 *
 * The single most valuable animation in the app and the cheapest: a control that
 * moves under your thumb confirms the tap landed before any state has changed.
 * Without it, a slow action reads as a missed tap and gets pressed twice.
 */
export function Press({
  children,
  style,
  scaleTo = PRESS_SCALE,
  ...props
}: PressableProps & {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  scaleTo?: number;
}) {
  const reduced = useReducedMotion();
  const pressed = useSharedValue(0);

  const animated = useAnimatedStyle(() => ({
    transform: [{ scale: 1 - pressed.value * (1 - scaleTo) }],
    opacity: 1 - pressed.value * 0.15,
  }));

  return (
    <AnimatedPressable
      {...props}
      onPressIn={(event) => {
        if (!reduced) pressed.value = withTiming(1, timing(duration.instant));
        props.onPressIn?.(event);
      }}
      onPressOut={(event) => {
        pressed.value = withSpring(0, spring);
        props.onPressOut?.(event);
      }}
      style={[style, animated]}
    >
      {children}
    </AnimatedPressable>
  );
}

/**
 * A number that counts up to its value.
 *
 * Used for the one figure on the dashboard that answers "how much is waiting".
 * Rolling it up draws the eye to the number rather than to the button below it,
 * and makes a changed count noticeable when you come back to the screen.
 *
 * Reanimated cannot drive text content from the UI thread, so this steps on a
 * timer instead. Cheap enough for a two-digit number rendered once per visit, and
 * it skips straight to the value under reduced motion.
 */
export function CountUp({
  value,
  style,
  durationMs = 520,
}: {
  value: number;
  style?: StyleProp<TextStyle>;
  durationMs?: number;
}) {
  const reduced = useReducedMotion();
  const [shown, setShown] = useState(reduced ? value : 0);

  useEffect(() => {
    if (reduced || value <= 0) {
      setShown(value);
      return;
    }

    // Around 24fps: fast enough to read as motion, few enough renders to be free.
    const steps = Math.min(value, 24);
    const stepMs = durationMs / steps;
    let step = 0;

    const id = setInterval(() => {
      step += 1;
      if (step >= steps) {
        setShown(value);
        clearInterval(id);
        return;
      }
      setShown(Math.round((value * step) / steps));
    }, stepMs);

    return () => clearInterval(id);
  }, [value, durationMs, reduced]);

  return <Text style={style}>{shown}</Text>;
}

/**
 * A progress fill that animates to its value.
 *
 * Tight spring, no overshoot: this is read as a quantity, and a progress bar that
 * bounces past its value and back is lying for a few frames.
 */
export function AnimatedFill({
  value,
  color,
  style,
}: {
  value: number;
  color: string;
  style?: StyleProp<ViewStyle>;
}) {
  const reduced = useReducedMotion();
  const clamped = Math.max(0, Math.min(1, value));
  const progress = useSharedValue(reduced ? clamped : 0);

  useEffect(() => {
    progress.value = reduced ? clamped : withSpring(clamped, springTight);
  }, [clamped, progress, reduced]);

  const animated = useAnimatedStyle(() => ({ width: `${progress.value * 100}%` }));

  return <Animated.View style={[style, { backgroundColor: color }, animated]} />;
}

/**
 * The card-deal animation.
 *
 * After a grade the card leaves in the direction of that grade — Again to the
 * left, Easy to the right — and the next one rises from beneath, the way the next
 * card in a deck comes up as you deal the top one off.
 *
 * The direction is not decoration. It is the only feedback that distinguishes a
 * grade you meant from one you mis-tapped, and it arrives before the new card has
 * rendered, so a wrong tap is obvious immediately rather than one card later.
 */
export function DealtCard({
  children,
  /** Changes when a new card arrives; drives the enter animation. */
  cardKey: key,
  /** -1 exits left, 1 exits right, 0 no exit yet. */
  exitDirection,
  style,
}: {
  children: React.ReactNode;
  cardKey: string;
  exitDirection: number;
  style?: StyleProp<ViewStyle>;
}) {
  const reduced = useReducedMotion();
  const enter = useSharedValue(reduced ? 1 : 0);

  useEffect(() => {
    if (reduced) {
      enter.value = 1;
      return;
    }
    enter.value = 0;
    enter.value = withSpring(1, spring);
  }, [key, enter, reduced]);

  const animated = useAnimatedStyle(() => ({
    opacity: enter.value,
    transform: [
      // Rises from beneath the previous card, slightly small, as it settles.
      { translateY: (1 - enter.value) * 26 },
      { scale: 0.94 + enter.value * 0.06 },
      // A whisper of the exit direction on the way in, so consecutive cards do
      // not all arrive from dead centre.
      { translateX: (1 - enter.value) * exitDirection * -8 },
    ],
  }));

  return <Animated.View style={[style, animated]}>{children}</Animated.View>;
}

/**
 * A one-shot entrance for something that should land with weight.
 *
 * Used for the end-of-session panel. Bouncy spring, because it is the one moment
 * in the app where a little celebration is the correct response.
 */
export function PopIn({
  children,
  style,
  config = spring,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  config?: typeof spring;
}) {
  const reduced = useReducedMotion();
  const progress = useSharedValue(reduced ? 1 : 0);

  useEffect(() => {
    if (reduced) {
      progress.value = 1;
      return;
    }
    progress.value = withSpring(1, config);
  }, [progress, reduced, config]);

  const animated = useAnimatedStyle(() => ({
    opacity: Math.min(1, progress.value * 1.6),
    transform: [{ scale: 0.86 + progress.value * 0.14 }],
  }));

  return <Animated.View style={[style, animated]}>{children}</Animated.View>;
}

/**
 * Cross-fades its children whenever `themeKey` changes.
 *
 * Switching language changes every colour on screen at once — including light to
 * dark, in two of the four themes. An instant swap reads as a glitch; a short
 * fade reads as the app changing clothes.
 */
export function ThemeFade({
  children,
  themeKey,
  style,
}: {
  children: React.ReactNode;
  themeKey: string;
  style?: StyleProp<ViewStyle>;
}) {
  const reduced = useReducedMotion();
  const opacity = useSharedValue(1);
  // Skip the first run. Without this the whole app dims to 35% and fades up on
  // every launch — the effect fires on mount, where there is no previous theme to
  // transition away from.
  const previousKey = useRef(themeKey);

  useEffect(() => {
    if (reduced || previousKey.current === themeKey) {
      previousKey.current = themeKey;
      return;
    }
    previousKey.current = themeKey;
    opacity.value = 0.35;
    opacity.value = withTiming(1, timing(duration.slow));
  }, [themeKey, opacity, reduced]);

  const animated = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return <Animated.View style={[style, animated]}>{children}</Animated.View>;
}
