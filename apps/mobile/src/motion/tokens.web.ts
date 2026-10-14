/**
 * Motion tokens, web build.
 *
 * Metro resolves `.web.ts` ahead of `.ts` for the web bundle, so this file is
 * what the website gets and `tokens.ts` is what the phones get. The values are
 * the same; the difference is that this one does not import Reanimated.
 *
 * That import is the entire reason this file exists. `Easing` and `ReduceMotion`
 * are runtime values, so touching them pulls Reanimated and its worklets runtime
 * into the web bundle — around a quarter of it — to animate seven components that
 * the browser can animate natively.
 *
 * Springs are approximated as duration plus easing. A cubic-bezier is not a
 * spring, but across 90-500ms and a few pixels of travel nobody can tell, and the
 * curves below are matched to what each spring actually does: whether it
 * overshoots, and by how much.
 */

export interface MotionSpring {
  /** Kept so the shape matches the native tokens and callers can pass either. */
  damping: number;
  stiffness: number;
  mass: number;
  overshootClamping: boolean;
  /** How long the browser should take. */
  durationMs: number;
  /** CSS easing that mimics this spring's settle. */
  easing: string;
}

/** The house spring: settles quickly, with just enough overshoot to feel physical. */
export const spring: MotionSpring = {
  damping: 18,
  stiffness: 220,
  mass: 0.9,
  overshootClamping: false,
  durationMs: 340,
  easing: 'cubic-bezier(0.34, 1.26, 0.64, 1)',
};

/** For things that must not overshoot — progress fills, meters, anything read as a value. */
export const springTight: MotionSpring = {
  damping: 26,
  stiffness: 260,
  mass: 0.8,
  overshootClamping: true,
  durationMs: 280,
  easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
};

/** Looser, for the celebratory beat at the end of a session. */
export const springBouncy: MotionSpring = {
  damping: 11,
  stiffness: 180,
  mass: 0.9,
  overshootClamping: false,
  durationMs: 520,
  easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
};

export const duration = {
  /** Press feedback. Must feel instant. */
  instant: 90,
  /** Fades and small state changes. */
  quick: 180,
  /** Entrances and exits. */
  base: 260,
  /** The longest anything should take. */
  slow: 340,
} as const;

/**
 * Standard easing for fades.
 *
 * Fast out, slow in: content arrives decisively and settles gently, which is the
 * material-motion convention and reads as confident rather than hesitant. Same
 * curve as the native `Easing.bezier(0.22, 1, 0.36, 1)`.
 */
export const ease = 'cubic-bezier(0.22, 1, 0.36, 1)';

export interface MotionTiming {
  durationMs: number;
  easing: string;
}

export const timing = (ms: number = duration.base): MotionTiming => ({
  durationMs: ms,
  easing: ease,
});

/**
 * Stagger between siblings entering together.
 *
 * Small on purpose. At 120ms and six items the last one lands two-thirds of a
 * second after the first, and the screen feels like it is loading rather than
 * arriving.
 */
export const STAGGER_MS = 38;

/** How far an entering element rises. Enough to read as motion, not as a jump. */
export const RISE_DISTANCE = 10;

/** Scale a control drops to while pressed. */
export const PRESS_SCALE = 0.975;
