import { useEffect, useRef, type RefObject } from 'react';

/**
 * Depth, driven by where the pointer is.
 *
 * The scenes are built in layers already — sky, then buildings, then the small
 * bright thing in front — so the only missing ingredient for depth is that the
 * layers should not move together. This writes two custom properties onto a
 * container, and every layer inside it shifts by its own depth multiplied by
 * them. Near things move further than far things, which is the whole of
 * parallax.
 *
 * Three things it is careful about, all of which are the difference between
 * depth and seasickness:
 *
 * - **It writes, it does not render.** The values land on the element as CSS
 *   variables inside a frame callback. React is not involved, so moving the
 *   pointer across a scene costs no re-renders.
 * - **It eases toward the pointer** rather than tracking it exactly. A layer
 *   pinned to the cursor feels like a sticker; one that lags slightly feels
 *   like it has mass.
 * - **It stops for anybody who asked it to.** `prefers-reduced-motion` leaves
 *   the variables at zero, so the scenes are simply still — not degraded, just
 *   not moving.
 *
 * Touch devices have no hovering pointer, so there the scene breathes on scroll
 * instead, which is the equivalent gesture.
 */

/** How far the furthest layer travels, in pixels. */
const TRAVEL = 14;
/** Fraction of the remaining distance covered each frame. Lower is heavier. */
const EASE = 0.08;

export function useParallax(ref: RefObject<HTMLElement | null>): void {
  // Held in a ref rather than state: these change every frame and nothing
  // should re-render because a pointer moved.
  const target = useRef({ x: 0, y: 0 });
  const current = useRef({ x: 0, y: 0 });

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (reduced?.matches) return;

    let frame = 0;
    let running = true;

    const onPointer = (event: PointerEvent) => {
      const box = node.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) return;
      // -1 to 1, from the middle of the scene.
      target.current = {
        x: ((event.clientX - box.left) / box.width) * 2 - 1,
        y: ((event.clientY - box.top) / box.height) * 2 - 1,
      };
    };

    /*
     * Without a pointer, the horizon answers to scrolling instead.
     *
     * A phone has no hover, and a scene that never moves on the device most of
     * this is read on would make the depth a desktop-only flourish.
     */
    const onScroll = () => {
      const box = node.getBoundingClientRect();
      const middle = box.top + box.height / 2;
      const offset = (middle - window.innerHeight / 2) / window.innerHeight;
      target.current = { x: 0, y: Math.max(-1, Math.min(1, offset * 2)) };
    };

    const canHover = window.matchMedia?.('(hover: hover)').matches ?? true;
    if (canHover) {
      node.addEventListener('pointermove', onPointer);
      // Settle back to centre when the pointer leaves, rather than freezing
      // the scene mid-tilt.
      node.addEventListener('pointerleave', () => (target.current = { x: 0, y: 0 }));
    } else {
      window.addEventListener('scroll', onScroll, { passive: true });
      onScroll();
    }

    const tick = () => {
      if (!running) return;

      current.current = {
        x: current.current.x + (target.current.x - current.current.x) * EASE,
        y: current.current.y + (target.current.y - current.current.y) * EASE,
      };

      node.style.setProperty('--px', `${(current.current.x * TRAVEL).toFixed(2)}px`);
      node.style.setProperty('--py', `${(current.current.y * TRAVEL * 0.5).toFixed(2)}px`);

      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);

    return () => {
      running = false;
      cancelAnimationFrame(frame);
      node.removeEventListener('pointermove', onPointer);
      window.removeEventListener('scroll', onScroll);
    };
  }, [ref]);
}
