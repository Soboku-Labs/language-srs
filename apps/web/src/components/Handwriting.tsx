import { useCallback, useEffect, useRef, useState } from 'react';
import { TextButton } from '../ui';

/**
 * A square to write the character in, with a finger.
 *
 * Handwriting is a separate memory from recognition — being able to pick 書
 * out of four options and being able to produce it stroke by stroke are not
 * the same skill, and the exams test both. There was a `writing` card kind
 * already; it just showed the meaning and asked you to imagine it, which is
 * the one kind of practice that cannot be done in your head.
 *
 * ## Why touch only
 *
 * Writing a character with a mouse is not writing a character. The motion is
 * from the wrist and the shoulder through a device with one degree of freedom
 * too few, and what you practise is mouse control. A learner who drills with a
 * mouse is building the wrong motor memory, so the card is not offered at all
 * on a device without a touchscreen rather than offered badly.
 *
 * The deck is the same on every device — a card is not deleted because you
 * opened the app on a laptop — so this is decided where the card is served,
 * not where it is made. Study Japanese on your phone and the writing cards are
 * there; open the same account on a desktop and they are quietly not in the
 * queue, waiting for the next time you have the phone.
 *
 * ## It does not mark your handwriting
 *
 * Deliberately. Recognising a hand-drawn character well enough to say "that
 * stroke was wrong" is a real model, and a bad one that says "wrong" to a
 * correct character is worse than no grading — it teaches the learner to
 * distrust the app. So: you draw it from memory, then the character is shown
 * and you say whether you had it. That is how handwriting is practised on
 * paper, and the honest version of what this can do today.
 *
 * The strokes are kept as points rather than as pixels, which is what a
 * recogniser would need later, and what scanning written practice back in
 * would compare against.
 */

/** One continuous mark, as the points it passed through. */
type Stroke = { x: number; y: number }[];

export function Handwriting({
  /** Shown faintly behind, once revealed, to compare against. */
  reveal,
  label,
}: {
  reveal?: string;
  label: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const drawing = useRef(false);

  /*
   * Redrawn from the stroke list rather than painted incrementally.
   *
   * Incremental painting is faster and wrong here: undo, clear and the
   * device-pixel-ratio resize below all need the whole picture again, and
   * keeping a parallel "what is on the canvas" state is how the two drift.
   */
  const paint = useCallback(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;

    const ratio = window.devicePixelRatio || 1;
    const size = canvas.clientWidth;
    if (canvas.width !== size * ratio) {
      canvas.width = size * ratio;
      canvas.height = size * ratio;
    }
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, size, size);

    // Guides: centre lines, the way squared practice paper is ruled.
    context.strokeStyle = getComputedStyle(canvas).getPropertyValue('--line') || '#E5E1D9';
    context.lineWidth = 1;
    context.setLineDash([4, 6]);
    context.beginPath();
    context.moveTo(size / 2, 0);
    context.lineTo(size / 2, size);
    context.moveTo(0, size / 2);
    context.lineTo(size, size / 2);
    context.stroke();
    context.setLineDash([]);

    context.strokeStyle = getComputedStyle(canvas).getPropertyValue('--ink') || '#1B1A17';
    context.lineWidth = Math.max(6, size / 28);
    context.lineCap = 'round';
    context.lineJoin = 'round';

    for (const stroke of strokes) {
      if (stroke.length === 0) continue;
      context.beginPath();
      context.moveTo(stroke[0]!.x, stroke[0]!.y);
      for (const point of stroke.slice(1)) context.lineTo(point.x, point.y);
      // A single tap is a dot, which `lineTo` alone would not draw.
      if (stroke.length === 1) context.lineTo(stroke[0]!.x + 0.1, stroke[0]!.y);
      context.stroke();
    }
  }, [strokes]);

  useEffect(() => {
    paint();
  }, [paint]);

  useEffect(() => {
    // The canvas is sized in CSS; a rotation or a split-screen changes that
    // and the backing store has to follow or the strokes stretch.
    const onResize = () => paint();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [paint]);

  const pointAt = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - box.left, y: event.clientY - box.top };
  };

  return (
    <div className="hand">
      <canvas
        ref={canvasRef}
        className="hand__pad"
        aria-label={label}
        role="img"
        /*
         * `touch-action: none` is in the stylesheet rather than here, but it
         * is the reason this works at all: without it the first vertical
         * stroke scrolls the page instead of drawing, and the card jumps away
         * from under the finger.
         */
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          drawing.current = true;
          /*
           * Read the position before the updater, not inside it.
           *
           * React nulls `currentTarget` once the handler returns, and a state
           * updater can run after that — so `pointAt(event)` inside the
           * updater throws on `null.getBoundingClientRect()`. It survived the
           * first stroke and crashed the second, which is exactly how a bug
           * that depends on when React chooses to flush presents.
           */
          const point = pointAt(event);
          setStrokes((current) => [...current, [point]]);
        }}
        onPointerMove={(event) => {
          if (!drawing.current) return;
          const point = pointAt(event);
          setStrokes((current) => {
            const rest = current.slice(0, -1);
            const last = current[current.length - 1] ?? [];
            return [...rest, [...last, point]];
          });
        }}
        onPointerUp={() => {
          drawing.current = false;
        }}
        onPointerCancel={() => {
          drawing.current = false;
        }}
      />

      {/* Shown only after the answer is revealed, so it cannot be traced. */}
      {reveal ? <span className="hand__reveal">{reveal}</span> : null}

      <div className="hand__tools">
        <TextButton
          label="Undo"
          muted
          onClick={() => setStrokes((current) => current.slice(0, -1))}
        />
        <TextButton label="Clear" muted onClick={() => setStrokes([])} />
        <span className="hand__count">
          {strokes.length === 0
            ? 'Write it from memory'
            : `${strokes.length} stroke${strokes.length === 1 ? '' : 's'}`}
        </span>
      </div>
    </div>
  );
}
