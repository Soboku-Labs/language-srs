import { getCulture, getLanguageTheme, type LanguageCode } from '@language-srs/core';
import type { ReactNode } from 'react';

/**
 * A place, drawn.
 *
 * Four line drawings, one per language, of the thing the app pictures when it
 * pictures that language: a pagoda over Beijing rooftops, a torii with a
 * mountain behind it, hanok eaves under Seoul's towers, a junk under the karsts
 * of Hạ Long.
 *
 * These are a port of `apps/mobile/src/components/LanguageArt.tsx`, path for
 * path. The paths are the drawing — redrawing them for the web would be a second
 * pagoda, and two pagodas is how the phone and the laptop stop being the same
 * product. Only the two things that are genuinely platform-specific differ:
 * `react-native-svg` becomes DOM SVG, and Reanimated becomes CSS.
 *
 * Why draw them rather than ship photographs: a photograph of a country is a
 * claim about it, and a stock one is a cliché somebody else chose. Line art at
 * this weight is closer to a woodblock print or a stamp — it says "here" without
 * insisting on which here — and it takes its colour from the language's own ink,
 * so the drawing and the interface are the same object.
 *
 * Deliberately quiet: two stroke weights, one accent, no fill beyond a wash. On
 * a screen you open every morning, an illustration that shouts becomes something
 * you stop seeing by the second week.
 */

export function LanguageArt({
  code,
  className,
  /** Skip the entrance — for art that is already on screen, or repeated in a list. */
  animate = true,
}: {
  code: LanguageCode;
  className?: string;
  animate?: boolean;
}) {
  const theme = getLanguageTheme(code);
  const culture = getCulture(code);
  const accent = theme.colors.accent;
  const wash = theme.colors.accentSoft;

  const motif = MOTIFS[culture.motif];
  if (!motif) return null;

  return (
    <svg
      className={`art${animate ? ' art--animate' : ''}${className ? ` ${className}` : ''}`}
      viewBox="0 0 320 120"
      fill="none"
      role="img"
      aria-label={`${culture.city}, drawn`}
      preserveAspectRatio="xMidYMax meet"
    >
      {motif({ accent, wash })}
    </svg>
  );
}

interface MotifProps {
  accent: string;
  wash: string;
}

/**
 * A layer of the drawing.
 *
 * Sky first, then the buildings, then the small bright thing — sun, moon, seal.
 * The order is the order you would draw it in, and the stagger is the only
 * motion here: nothing loops, nothing floats, and under reduce-motion the whole
 * thing is simply present.
 *
 * The delay is a custom property rather than an inline `animation-delay` so the
 * reduced-motion rule in the stylesheet can flatten every one of them at once.
 */
function Layer({ index, children }: { index: number; children: ReactNode }) {
  return (
    <g className="art__layer" style={{ ['--layer' as string]: index }}>
      {children}
    </g>
  );
}

/**
 * Beijing — a pagoda on a terrace, city roofs behind, a seal in the sky.
 *
 * The seal is the one square in the drawing, and it is the only filled shape: a
 * red stamp on paper is where the Mandarin accent comes from in the first place,
 * so the picture and the palette explain each other.
 */
function pagoda({ accent, wash }: MotifProps) {
  return (
    <>
      <Layer index={0}>
        <path d="M0 96 H320" stroke={accent} strokeWidth={1} opacity={0.35} />
        <path d="M18 96 V78 h16 v18 M44 96 V70 h20 v26 M74 96 V82 h14 v14" stroke={accent} strokeWidth={1.2} opacity={0.4} />
        <path d="M238 96 V74 h18 v22 M266 96 V84 h16 v12 M292 96 V66 h14 v30" stroke={accent} strokeWidth={1.2} opacity={0.4} />
      </Layer>

      <Layer index={1}>
        {/* Three tiers, each roof wider than the storey under it. */}
        <path d="M120 96 V74 h80 v22" stroke={accent} strokeWidth={1.6} />
        <path d="M104 74 q56 -14 112 0" stroke={accent} strokeWidth={2} strokeLinecap="round" />
        <path d="M130 74 V56 h60 v18" stroke={accent} strokeWidth={1.6} />
        <path d="M116 56 q44 -12 88 0" stroke={accent} strokeWidth={2} strokeLinecap="round" />
        <path d="M142 56 V40 h36 v16" stroke={accent} strokeWidth={1.6} />
        <path d="M128 40 q32 -10 64 0" stroke={accent} strokeWidth={2} strokeLinecap="round" />
        <path d="M160 40 V28" stroke={accent} strokeWidth={1.6} strokeLinecap="round" />
      </Layer>

      <Layer index={2}>
        <rect x={252} y={24} width={22} height={22} rx={2} fill={accent} opacity={0.9} />
        <path d="M257 31 h12 M257 36 h12 M263 28 v14" stroke={wash} strokeWidth={1.4} strokeLinecap="round" />
      </Layer>
    </>
  );
}

/**
 * Kyoto — a torii, a mountain behind it, the sun above.
 *
 * The gate is drawn heavier than the mountain on purpose: the thing in front of
 * you is the thing you are walking through.
 */
function torii({ accent, wash }: MotifProps) {
  return (
    <>
      <Layer index={0}>
        <path d="M0 96 H320" stroke={accent} strokeWidth={1} opacity={0.35} />
        <path d="M196 96 l52 -46 22 20 14 -12 36 38 Z" stroke={accent} strokeWidth={1.3} opacity={0.45} fill="none" />
        <path d="M232 62 l16 -12 10 9" stroke={accent} strokeWidth={1.3} opacity={0.7} />
        <path d="M22 96 l40 -34 30 26" stroke={accent} strokeWidth={1.2} opacity={0.3} />
      </Layer>

      <Layer index={1}>
        <path d="M96 96 V44 M176 96 V44" stroke={accent} strokeWidth={3} strokeLinecap="round" />
        <path d="M84 44 h104" stroke={accent} strokeWidth={2} />
        <path d="M76 34 q60 -10 120 0" stroke={accent} strokeWidth={3.4} strokeLinecap="round" />
        <path d="M104 58 h64" stroke={accent} strokeWidth={2.2} strokeLinecap="round" />
      </Layer>

      <Layer index={2}>
        <circle cx={58} cy={34} r={13} fill={accent} opacity={0.85} />
        <circle cx={58} cy={34} r={19} stroke={accent} strokeWidth={1} opacity={0.3} fill={wash} fillOpacity={0.15} />
      </Layer>
    </>
  );
}

/**
 * Seoul — hanok eaves in front, towers behind, a moon jar's curve as the moon.
 *
 * The old roofline crosses in front of the new one because that is what the city
 * actually looks like from Bukchon, and because a language is learned in the
 * present tense.
 */
function hanok({ accent, wash }: MotifProps) {
  return (
    <>
      <Layer index={0}>
        <path d="M0 96 H320" stroke={accent} strokeWidth={1} opacity={0.35} />
        <path
          d="M204 96 V40 h16 v56 M228 96 V54 h14 v42 M250 96 V30 h18 v66 M276 96 V60 h16 v36"
          stroke={accent}
          strokeWidth={1.2}
          opacity={0.35}
        />
      </Layer>

      <Layer index={1}>
        {/* Two eaves, the near one lower, both with the upward flick at the tip. */}
        <path d="M28 70 q52 -26 104 0" stroke={accent} strokeWidth={2.4} strokeLinecap="round" />
        <path d="M28 70 q-8 -2 -12 -8 M132 70 q8 -2 12 -8" stroke={accent} strokeWidth={2.4} strokeLinecap="round" />
        <path d="M40 70 V96 M120 70 V96" stroke={accent} strokeWidth={1.6} />
        <path d="M52 96 V78 h56 v18" stroke={accent} strokeWidth={1.3} opacity={0.8} />
        <path d="M96 88 q46 -22 92 0" stroke={accent} strokeWidth={2.2} strokeLinecap="round" opacity={0.9} />
        <path d="M96 88 q-7 -2 -11 -7 M188 88 q7 -2 11 -7" stroke={accent} strokeWidth={2.2} strokeLinecap="round" opacity={0.9} />
      </Layer>

      <Layer index={2}>
        <circle cx={264} cy={28} r={14} fill={wash} stroke={accent} strokeWidth={1.6} />
        <path d="M254 28 q10 -8 20 0" stroke={accent} strokeWidth={1} opacity={0.5} />
      </Layer>
    </>
  );
}

/**
 * Hạ Long — a junk under limestone karsts, and a lotus on the water.
 *
 * The sails are the drawing's subject and get its only heavy strokes; the karsts
 * behind them are the same shape repeated at three sizes, which is roughly what
 * the bay does.
 */
function junk({ accent, wash }: MotifProps) {
  return (
    <>
      <Layer index={0}>
        <path d="M0 96 H320" stroke={accent} strokeWidth={1} opacity={0.35} />
        <path d="M204 96 q14 -46 30 -46 t28 46 Z" stroke={accent} strokeWidth={1.3} opacity={0.4} fill="none" />
        <path d="M248 96 q10 -32 22 -32 t20 32 Z" stroke={accent} strokeWidth={1.3} opacity={0.3} fill="none" />
        <path d="M18 96 q8 -24 18 -24 t16 24 Z" stroke={accent} strokeWidth={1.3} opacity={0.25} fill="none" />
      </Layer>

      <Layer index={1}>
        {/* Two battened sails, the classic red-brown junk rig. */}
        <path d="M120 88 V26" stroke={accent} strokeWidth={2} strokeLinecap="round" />
        <path d="M120 30 q34 16 30 46 h-30 Z" fill={accent} fillOpacity={0.16} stroke={accent} strokeWidth={2} />
        <path d="M124 42 h24 M124 54 h27 M124 66 h28" stroke={accent} strokeWidth={1} opacity={0.6} />
        <path d="M92 88 V44" stroke={accent} strokeWidth={1.8} strokeLinecap="round" />
        <path d="M92 48 q-22 12 -19 28 h19 Z" fill={accent} fillOpacity={0.12} stroke={accent} strokeWidth={1.8} />
        <path d="M64 88 h84 l-10 10 H74 Z" fill={accent} fillOpacity={0.2} stroke={accent} strokeWidth={2} strokeLinejoin="round" />
      </Layer>

      <Layer index={2}>
        {/* Water: two strokes, not a texture. */}
        <path d="M24 104 q16 -6 32 0 t32 0" stroke={accent} strokeWidth={1.2} opacity={0.45} strokeLinecap="round" />
        <path d="M180 108 q16 -6 32 0 t32 0" stroke={accent} strokeWidth={1.2} opacity={0.35} strokeLinecap="round" />
        <g opacity={0.9}>
          <path d="M276 92 q-9 -5 -10 -14 q9 3 10 14 Z" fill={accent} fillOpacity={0.35} stroke={accent} strokeWidth={1.2} />
          <path d="M276 92 q9 -5 10 -14 q-9 3 -10 14 Z" fill={wash} stroke={accent} strokeWidth={1.2} />
        </g>
      </Layer>
    </>
  );
}

const MOTIFS: Record<string, (props: MotifProps) => ReactNode> = { pagoda, torii, hanok, junk };
