import type { ReactNode } from 'react';
import { useTheme } from './theme';
import type { LanguageCode } from '@language-srs/core';

/**
 * The Suboku primitives.
 *
 * The same set the Expo app has — Screen, Section, Title, Caption, BigButton,
 * TextButton, Row, Stat, DetailRow, Pill, ProgressBar — so the two render the
 * same design and a change to the system is a change in both places rather than
 * a divergence.
 *
 * Styling is class names against `styles.css`. These components exist for the
 * semantics and the shared vocabulary, not to hold CSS.
 */

/**
 * A page.
 *
 * `layer` says which of the app's three depths this is, because they are not
 * the same kind of thing and should not read as one. The door and the day are
 * documents: they scroll, they explain, they are looked over. The loop is not —
 * it is one card at a time, answered dozens of times in a row, usually on a
 * phone, and it holds the viewport so the card sits in the middle and the
 * answers sit under the thumb rather than drifting up the screen.
 */
export function Screen({
  children,
  flush = false,
  layer,
}: {
  children: ReactNode;
  flush?: boolean;
  layer?: 'door' | 'day' | 'loop';
}) {
  return (
    <main className={`screen${flush ? ' screen--flush' : ''}${layer ? ` screen--${layer}` : ''}`}>
      {children}
    </main>
  );
}

/** Staggered entrance. `index` orders siblings top to bottom as you would read them. */
export function Rise({
  children,
  index = 0,
  className,
}: {
  children: ReactNode;
  index?: number;
  className?: string;
}) {
  return (
    <div
      className={`rise${className ? ` ${className}` : ''}`}
      style={{ ['--rise-index' as string]: index }}
    >
      {children}
    </div>
  );
}

export function Section({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="section">
      {title ? <h2 className="section__title">{title}</h2> : null}
      {children}
    </section>
  );
}

export function Title({ children }: { children: ReactNode }) {
  return <h1 className="title">{children}</h1>;
}

export function Heading({ children }: { children: ReactNode }) {
  return <p className="heading">{children}</p>;
}

export function Caption({ children, loud = false }: { children: ReactNode; loud?: boolean }) {
  return <p className={`caption${loud ? ' caption--loud' : ''}`}>{children}</p>;
}

export function Row({
  children,
  between = false,
  center = false,
  wrap = false,
  tight = false,
}: {
  children: ReactNode;
  between?: boolean;
  center?: boolean;
  wrap?: boolean;
  tight?: boolean;
}) {
  const classes = ['row'];
  if (between) classes.push('row--between');
  if (center) classes.push('row--center');
  if (wrap) classes.push('row--wrap');
  if (tight) classes.push('row--tight');
  return <div className={classes.join(' ')}>{children}</div>;
}

export function Card({ children }: { children: ReactNode }) {
  return <div className="card">{children}</div>;
}

export function Pill({ label }: { label: string }) {
  return <span className="pill">{label}</span>;
}

/**
 * The primary action.
 *
 * Ink, not accent. A full-width slab of the language's accent was the loudest
 * element on every screen, and an accent occupying a quarter of the canvas has
 * stopped being an accent.
 */
export function BigButton({
  label,
  hint,
  onClick,
  disabled,
  /**
   * `quiet` draws it as an outline rather than a filled block.
   *
   * For a second full-width action on the same screen. Two filled buttons
   * read as two primary actions, and whichever is lower on the page wins by
   * weight — on the sign-in screen that made "Use this device" the loudest
   * thing on a page whose job is signing in.
   */
  quiet = false,
}: {
  label: string;
  hint?: string;
  onClick: () => void;
  disabled?: boolean;
  quiet?: boolean;
}) {
  return (
    <button
      type="button"
      className={`button${quiet ? ' button--quiet' : ''}`}
      onClick={onClick}
      disabled={disabled}
    >
      {label}
      {hint ? <span className="button__hint">{hint}</span> : null}
    </button>
  );
}

/** A quiet secondary action. Text and a tap target, no box. */
export function TextButton({
  label,
  onClick,
  muted = false,
  disabled = false,
  color,
}: {
  label: string;
  onClick: () => void;
  muted?: boolean;
  /** For an action already under way, so a second tap cannot start it twice. */
  disabled?: boolean;
  color?: string;
}) {
  return (
    <button
      type="button"
      className={`link${muted ? ' link--muted' : ''}`}
      onClick={onClick}
      disabled={disabled}
      {...(color ? { style: { color } } : {})}
    >
      {label}
    </button>
  );
}

/**
 * A small group of mutually exclusive settings, shown as one control.
 *
 * Separate buttons would need a label each to say what they belong to; a
 * segmented group says it once and shows the current answer without a word
 * like "selected". Narrow enough to sit in a bar, which is the point — these
 * are the settings worth changing from the page they affect.
 */
export function Segmented({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { value: string; label: string }[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className="segmented__option"
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function Choice({
  label,
  selected,
  onClick,
}: {
  label: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button type="button" className="choice" aria-pressed={selected} onClick={onClick}>
      {label}
    </button>
  );
}

export function ProgressBar({ value, color }: { value: number; color?: string }) {
  const percent = Math.max(0, Math.min(1, value)) * 100;
  return (
    <div className="track" role="progressbar" aria-valuenow={Math.round(percent)}>
      <div className="track__fill" style={{ ['--fill' as string]: percent / 100, ...(color ? { background: color } : {}) }} />
    </div>
  );
}

/** One number and its label. Three on a row read as a sentence about your progress. */
export function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="stat">
      <span className="stat__value" {...(color ? { style: { color } } : {})}>
        {value}
      </span>
      <span className="stat__label">{label}</span>
    </div>
  );
}

/** A label and value on one line, for lists of facts. */
export function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="detail">
      <span className="detail__label">{label}</span>
      <span className="detail__value">{value}</span>
    </div>
  );
}

/**
 * Target text with its tones coloured.
 *
 * One span per syllable, coloured from the language's tone ramp. For a
 * non-tonal language — or a word with no tone data — this is a plain string, and
 * the colour is simply absent rather than defaulted to something meaningless.
 */
export function ToneText({
  text,
  tones,
  languageCode,
  size,
}: {
  text: string;
  tones?: number[];
  languageCode: LanguageCode;
  size: number;
}) {
  const { toneColor } = useTheme();
  const style = { fontSize: size, fontWeight: 'var(--weight-medium)', lineHeight: 1.15 } as const;

  if (!tones || tones.length === 0) {
    return <span style={style}>{text}</span>;
  }

  // Vietnamese writes a syllable as a whitespace-separated word; the CJK
  // languages write one character per syllable.
  const syllables = text.includes(' ') ? text.split(/(\s+)/) : [...text];
  let toneIndex = 0;

  return (
    <span style={style}>
      {syllables.map((syllable, index) => {
        if (/^\s+$/.test(syllable)) return <span key={index}>{syllable}</span>;
        const tone = tones[toneIndex];
        toneIndex += 1;
        return (
          <span key={index} style={tone ? { color: toneColor(tone) } : undefined}>
            {syllable}
          </span>
        );
      })}
    </span>
  );
}
