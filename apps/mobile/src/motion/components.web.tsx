import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Pressable,
  Text,
  View,
  type PressableProps,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import {
  PRESS_SCALE,
  RISE_DISTANCE,
  STAGGER_MS,
  duration,
  ease,
  spring,
  springTight,
  timing,
  type MotionSpring,
} from './tokens.web';

/**
 * The motion system, web build.
 *
 * Same seven components and the same API as `components.tsx`; Metro resolves
 * `.web.tsx` ahead of `.tsx` for the web bundle, so the phones keep Reanimated
 * and the website gets this.
 *
 * Why bother: Reanimated plus its worklets runtime was about a quarter of the web
 * bundle, and on the web every one of these animations is something the browser
 * does natively. Reanimated earns its weight on a phone, where it runs animations
 * off the JS thread; in a browser there is no bridge to avoid, and it is a large
 * polyfill for `Element.animate`.
 *
 * The Web Animations API is used rather than CSS transitions because it needs no
 * stylesheet injection, no class names — which react-native-web does not expose as
 * public API — and it composes with the inline styles these components already
 * receive from callers.
 */

/** The DOM node react-native-web renders a View as. */
type DomNode = HTMLElement | null;

/**
 * Whether the viewer asked for less motion.
 *
 * The native build gets this from Reanimated's `useReducedMotion`; on the web it
 * is a media query, and it is watched rather than read once, because someone can
 * change the setting with the app open.
 */
function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = (event: MediaQueryListEvent) => setReduced(event.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  return reduced;
}

/**
 * Run one animation on a node, cancelling whatever it was doing.
 *
 * `fill: 'forwards'` holds the final frame, which is what every caller here
 * wants — these are state changes, not loops. Guarded because `animate` is
 * missing in older browsers and in any server-rendered pass, where the right
 * behaviour is to land on the final state with no animation at all.
 */
function animate(node: DomNode, keyframes: Keyframe[], options: KeyframeAnimationOptions): void {
  if (!node || typeof node.animate !== 'function') return;
  node.getAnimations?.().forEach((existing) => existing.cancel());
  node.animate(keyframes, { fill: 'forwards', ...options });
}

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
  const ref = useRef<View>(null);

  useEffect(() => {
    const node = ref.current as unknown as DomNode;
    if (!node) return;

    if (reduced) {
      node.style.opacity = '1';
      node.style.transform = 'none';
      return;
    }

    const { durationMs, easing } = timing(duration.base);
    animate(
      node,
      [
        { opacity: 0, transform: `translateY(${distance}px)` },
        { opacity: 1, transform: 'translateY(0px)' },
      ],
      { duration: durationMs, easing, delay: index * STAGGER_MS },
    );
  }, [index, distance, reduced]);

  // Starts invisible so the first frame is not a flash of the final position;
  // the animation's own first keyframe takes over immediately.
  return (
    <View ref={ref} style={[style, reduced ? null : { opacity: 0 }]}>
      {children}
    </View>
  );
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
  const ref = useRef<View>(null);

  const to = useCallback(
    (scale: number, opacity: number, ms: number, easing: string) => {
      const node = ref.current as unknown as DomNode;
      if (!node || reduced) return;
      animate(node, [{ transform: `scale(${scale})`, opacity }], { duration: ms, easing });
    },
    [reduced],
  );

  return (
    <Pressable
      {...props}
      ref={ref}
      onPressIn={(event) => {
        to(scaleTo, 0.85, duration.instant, ease);
        props.onPressIn?.(event);
      }}
      onPressOut={(event) => {
        to(1, 1, spring.durationMs, spring.easing);
        props.onPressOut?.(event);
      }}
      style={style}
    >
      {children}
    </Pressable>
  );
}

/**
 * A number that counts up to its value.
 *
 * Used for the one figure on the dashboard that answers "how much is waiting".
 * Rolling it up draws the eye to the number rather than to the button below it,
 * and makes a changed count noticeable when you come back to the screen.
 *
 * Identical to the native implementation: text content cannot be driven by an
 * animation on either platform, so both step on a timer.
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
  const ref = useRef<View>(null);
  const previous = useRef(reduced ? clamped : 0);

  useEffect(() => {
    const node = ref.current as unknown as DomNode;
    if (!node) return;

    const target = `${clamped * 100}%`;
    if (reduced) {
      node.style.width = target;
      previous.current = clamped;
      return;
    }

    animate(node, [{ width: `${previous.current * 100}%` }, { width: target }], {
      duration: springTight.durationMs,
      easing: springTight.easing,
    });
    previous.current = clamped;
  }, [clamped, reduced]);

  return <View ref={ref} style={[style, { backgroundColor: color, width: 0 }]} />;
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
  const ref = useRef<View>(null);

  useEffect(() => {
    const node = ref.current as unknown as DomNode;
    if (!node) return;

    if (reduced) {
      node.style.opacity = '1';
      node.style.transform = 'none';
      return;
    }

    animate(
      node,
      [
        {
          opacity: 0,
          // Rises from beneath the previous card, slightly small, as it settles,
          // with a whisper of the exit direction so consecutive cards do not all
          // arrive from dead centre.
          transform: `translateY(26px) scale(0.94) translateX(${exitDirection * -8}px)`,
        },
        { opacity: 1, transform: 'translateY(0px) scale(1) translateX(0px)' },
      ],
      { duration: spring.durationMs, easing: spring.easing },
    );
  }, [key, exitDirection, reduced]);

  return (
    <View ref={ref} style={[style, reduced ? null : { opacity: 0 }]}>
      {children}
    </View>
  );
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
  config?: MotionSpring;
}) {
  const reduced = useReducedMotion();
  const ref = useRef<View>(null);

  useEffect(() => {
    const node = ref.current as unknown as DomNode;
    if (!node) return;

    if (reduced) {
      node.style.opacity = '1';
      node.style.transform = 'none';
      return;
    }

    animate(
      node,
      [
        { opacity: 0, transform: 'scale(0.86)' },
        { opacity: 1, transform: 'scale(1)' },
      ],
      { duration: config.durationMs, easing: config.easing },
    );
  }, [reduced, config]);

  return (
    <View ref={ref} style={[style, reduced ? null : { opacity: 0 }]}>
      {children}
    </View>
  );
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
  const ref = useRef<View>(null);
  // Skip the first run. Without this the whole app dims to 35% and fades up on
  // every launch — the effect fires on mount, where there is no previous theme to
  // transition away from.
  const previousKey = useRef(themeKey);

  useEffect(() => {
    const node = ref.current as unknown as DomNode;
    if (reduced || previousKey.current === themeKey) {
      previousKey.current = themeKey;
      return;
    }
    previousKey.current = themeKey;

    const { durationMs, easing } = timing(duration.slow);
    animate(node, [{ opacity: 0.35 }, { opacity: 1 }], { duration: durationMs, easing });
  }, [themeKey, reduced]);

  return (
    <View ref={ref} style={style}>
      {children}
    </View>
  );
}
