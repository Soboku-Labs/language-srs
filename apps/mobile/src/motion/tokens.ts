import { Easing, ReduceMotion, type WithSpringConfig, type WithTimingConfig } from 'react-native-reanimated';

/**
 * Motion tokens for the Paper & Ink design language.
 *
 * Two ideas govern every value here.
 *
 * **Paper has weight.** Surfaces in this app are physical: a card is a thing you
 * pick up, put down and deal off a deck. So movement is spring-based rather than
 * eased — springs settle the way an object settles, and a card that decelerates
 * linearly reads as a sprite, not a sheet of paper.
 *
 * **Motion explains, it does not entertain.** Every animation in the app encodes
 * where something came from or where it went. If an animation can be removed
 * without the interface becoming harder to follow, it should not have been added.
 * That is the test each pattern in `docs/DESIGN.md` is written against.
 *
 * Durations are deliberately short. Anything past ~350ms on a screen you visit
 * forty times a day stops being polish and becomes a queue.
 */

/** The house spring: settles quickly, with just enough overshoot to feel physical. */
export const spring: WithSpringConfig = {
  damping: 18,
  stiffness: 220,
  mass: 0.9,
  overshootClamping: false,
  reduceMotion: ReduceMotion.System,
};

/** For things that must not overshoot — progress fills, meters, anything read as a value. */
export const springTight: WithSpringConfig = {
  damping: 26,
  stiffness: 260,
  mass: 0.8,
  overshootClamping: true,
  reduceMotion: ReduceMotion.System,
};

/** Looser, for the celebratory beat at the end of a session. */
export const springBouncy: WithSpringConfig = {
  damping: 11,
  stiffness: 180,
  mass: 0.9,
  overshootClamping: false,
  reduceMotion: ReduceMotion.System,
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
 * material-motion convention and reads as confident rather than hesitant.
 */
export const ease = Easing.bezier(0.22, 1, 0.36, 1);

export const timing = (ms: number = duration.base): WithTimingConfig => ({
  duration: ms,
  easing: ease,
  reduceMotion: ReduceMotion.System,
});

/**
 * Stagger between siblings entering together.
 *
 * Small on purpose. At 120ms and six items the last one lands two-thirds of a
 * second after the first, and the screen feels like it is loading rather than
 * arriving.
 */
export const STAGGER_MS = 45;

/** How far an entering element rises. Enough to read as motion, not as a jump. */
export const RISE_DISTANCE = 14;

/** Scale a control drops to while pressed. */
export const PRESS_SCALE = 0.965;
