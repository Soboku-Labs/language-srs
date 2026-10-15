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
  /**
   * How the drawing meets its box.
   *
   * `meet` fits the whole thing inside, which is right for a thumbnail. `slice`
   * fills the box and lets the edges run off it, which is what a scene wants:
   * a horizon should reach both sides of the window rather than sitting in the
   * middle of one with margins.
   */
  fit = 'meet',
}: {
  code: LanguageCode;
  className?: string;
  animate?: boolean;
  fit?: 'meet' | 'slice';
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
      /*
        Taller than the drawing used to be, and extended upwards only.

        The old box was 320x120 — a strip. In a window shaped like a doorway
        that leaves the top two thirds as empty gradient no matter how the art
        is cropped, which is the real reason those blocks looked unused. The
        origin moves to -80 instead of the paths moving down: every existing
        coordinate stays exactly where it was, and the new room is all sky.
      */
      viewBox="0 -80 320 200"
      fill="none"
      role="img"
      aria-label={`${culture.city}, drawn`}
      preserveAspectRatio={`xMidYMax ${fit}`}
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
 * One cherry blossom: five petals round a centre.
 *
 * Scattered petals were tried first and read as tadpoles — at this size a lone
 * petal is a blob, and blobs in a sky are debris. Five round one point is
 * unmistakably a flower, and a few on a branch is unmistakably spring.
 */
function Blossom({ cx, cy, r, accent, opacity = 0.5 }: { cx: number; cy: number; r: number; accent: string; opacity?: number }) {
  const petals: [number, number][] = [
    [0, -1],
    [-0.95, -0.31],
    [-0.59, 0.81],
    [0.59, 0.81],
    [0.95, -0.31],
  ];
  return (
    <g opacity={opacity}>
      {petals.map(([dx, dy], index) => (
        <circle key={index} cx={cx + dx * r} cy={cy + dy * r} r={r * 0.62} fill={accent} fillOpacity={0.28} stroke={accent} strokeWidth={0.5} />
      ))}
      <circle cx={cx} cy={cy} r={r * 0.3} fill={accent} fillOpacity={0.6} />
    </g>
  );
}

/**
 * Beijing — a pagoda on its terrace, hutong roofs at its feet, a seal in the sky.
 *
 * Drawn at five depths rather than three, because the scenes crop in close now
 * and a drawing with three planes reads as three cut-outs when you move across
 * it. Far ridge, city blocks, courtyard roofs, the pagoda, then a wall in front
 * of everything — which is roughly the order you actually meet them walking
 * towards one.
 *
 * The detail that matters is the eave. A pagoda is recognisable from the lift
 * at the ends of its roofs and almost nothing else, so each of the four gets
 * its tips flicked up rather than merely being a wider line than the one below.
 *
 * The seal is still the only filled shape in any of these drawings: a red stamp
 * on paper is where the Mandarin accent comes from, so the picture and the
 * palette go on explaining each other.
 */
function pagoda({ accent, wash }: MotifProps) {
  return (
    <>
      <Layer index={0}>
        {/* High cloud, drawn as three flat strokes rather than shapes. At this
            weight a cloud with an outline becomes the loudest thing in the
            sky. */}
        <path d="M96 -52 q32 -7 66 -2 M150 -72 q34 -8 68 -2 M118 -22 q28 -6 56 -1 M12 -40 q26 -6 52 -1" stroke={accent} strokeWidth={1.1} opacity={0.14} strokeLinecap="round" fill="none" />
        <path d="M0 78 q44 -14 88 -7 t74 3 q46 5 86 -9 t72 -5" stroke={accent} strokeWidth={1} opacity={0.22} fill="none" />
        <path d="M0 96 H320" stroke={accent} strokeWidth={1} opacity={0.35} />
      </Layer>

      <Layer index={1}>
        {/* The city, kept to a rhythm of verticals so it reads as blocks. */}
        <path d="M10 96 V70 h13 v26 M28 96 V62 h11 v34 M44 96 V76 h10 v20" stroke={accent} strokeWidth={1.1} opacity={0.32} />
        <path d="M266 96 V68 h13 v28 M284 96 V58 h11 v38 M300 96 V74 h14 v22" stroke={accent} strokeWidth={1.1} opacity={0.32} />
        <path d="M13 76 h7 M13 83 h7 M31 68 h5 M31 76 h5 M269 74 h7 M269 82 h7 M287 64 h5 M287 72 h5" stroke={accent} strokeWidth={0.8} opacity={0.28} />
      </Layer>

      <Layer index={2}>
        {/* Courtyard roofs: low, grey, tiled in short ticks. */}
        <path d="M0 96 V86 h56 v10" stroke={accent} strokeWidth={1.2} opacity={0.45} />
        <path d="M-4 86 h64" stroke={accent} strokeWidth={1.6} opacity={0.5} />
        <path d="M6 86 v-4 M16 86 v-4 M26 86 v-4 M36 86 v-4 M46 86 v-4" stroke={accent} strokeWidth={0.8} opacity={0.35} />
        <path d="M252 96 V88 h68 v8" stroke={accent} strokeWidth={1.2} opacity={0.4} />
        <path d="M248 88 h76" stroke={accent} strokeWidth={1.6} opacity={0.45} />
        {/* A moon gate in the near wall, which is the one shape that says hutong. */}
        {/* A moon gate is a circle in a wall, so it is drawn as one. */}
        <circle cx={278} cy={84} r={11} stroke={accent} strokeWidth={1.2} opacity={0.5} fill={wash} fillOpacity={0.3} />
        <path d="M267 96 V84 M289 96 V84" stroke={accent} strokeWidth={1.2} opacity={0.4} />
      </Layer>

      <Layer index={3}>
        {/* The terrace it stands on. */}
        <path d="M104 96 h112 M110 92 h100" stroke={accent} strokeWidth={1.4} opacity={0.75} />

        {/* Four storeys, each eave wider than the one above and flicked at the tips. */}
        <path d="M124 92 V76 h72 v16" stroke={accent} strokeWidth={1.6} />
        <path d="M106 76 q54 -13 108 0" stroke={accent} strokeWidth={2.2} strokeLinecap="round" />
        <path d="M106 76 q-7 -1 -10 -6 M214 76 q7 -1 10 -6" stroke={accent} strokeWidth={2} strokeLinecap="round" />
        <path d="M112 79 h96" stroke={accent} strokeWidth={0.9} opacity={0.45} />

        <path d="M132 76 V60 h56 v16" stroke={accent} strokeWidth={1.6} />
        <path d="M116 60 q44 -11 88 0" stroke={accent} strokeWidth={2.1} strokeLinecap="round" />
        <path d="M116 60 q-6 -1 -9 -5 M204 60 q6 -1 9 -5" stroke={accent} strokeWidth={1.9} strokeLinecap="round" />
        <path d="M122 63 h76" stroke={accent} strokeWidth={0.9} opacity={0.45} />

        <path d="M140 60 V46 h40 v14" stroke={accent} strokeWidth={1.6} />
        <path d="M126 46 q34 -9 68 0" stroke={accent} strokeWidth={2} strokeLinecap="round" />
        <path d="M126 46 q-5 -1 -8 -4 M194 46 q5 -1 8 -4" stroke={accent} strokeWidth={1.8} strokeLinecap="round" />

        <path d="M148 46 V34 h24 v12" stroke={accent} strokeWidth={1.5} />
        <path d="M136 34 q24 -7 48 0" stroke={accent} strokeWidth={1.9} strokeLinecap="round" />
        <path d="M136 34 q-4 -1 -7 -4 M184 34 q4 -1 7 -4" stroke={accent} strokeWidth={1.7} strokeLinecap="round" />

        {/* Doorway and windows, which give the tiers their scale. */}
        <path d="M152 92 V82 q8 -6 16 0 v10" stroke={accent} strokeWidth={1.3} fill="none" />
        <path d="M132 86 h12 M176 86 h12 M150 70 h20 M154 54 h12" stroke={accent} strokeWidth={1.1} opacity={0.75} />

        {/* Finial: rings and a point, the thing the whole roofline aims at. */}
        <path d="M160 34 V22" stroke={accent} strokeWidth={1.6} strokeLinecap="round" />
        <path d="M156 29 h8 M157 26 h6" stroke={accent} strokeWidth={1.1} />
        <circle cx={160} cy={20} r={2} fill={accent} opacity={0.85} />
      </Layer>

      <Layer index={4}>
        {/* A wall in front of everything, with a scholar tree over it. */}
        <path d="M0 110 h78 M-2 104 h84" stroke={accent} strokeWidth={1.3} opacity={0.5} />
        {/* A branch leaning in from the edge, rather than a mark in mid-air. */}
        <path d="M320 86 q-20 1 -34 11" stroke={accent} strokeWidth={1.5} opacity={0.4} strokeLinecap="round" fill="none" />
        <path d="M302 92 q-2 -8 2 -13 M310 88 q-1 -8 3 -12 M292 97 q-3 -7 0 -12" stroke={accent} strokeWidth={1} opacity={0.32} strokeLinecap="round" fill="none" />
      </Layer>

      <Layer index={4}>
        {/*
          Kites, because that is what is actually in this sky.

          A diamond, its cross-spars, and a long tail going slack — and the
          line running all the way down to somebody out of frame, which is
          what makes it a kite rather than a diamond floating in the air.
        */}
        <path d="M132 -64 l13 17 -13 17 -13 -17 Z" stroke={accent} strokeWidth={1.4} opacity={0.55} fill={wash} fillOpacity={0.35} />
        <path d="M119 -47 h26 M132 -64 v34" stroke={accent} strokeWidth={0.9} opacity={0.4} />
        <path d="M132 -30 q5 9 -2 15 q-6 6 0 13 q5 6 -1 12" stroke={accent} strokeWidth={1} opacity={0.4} fill="none" strokeLinecap="round" />
        <path d="M132 -30 q14 40 26 72" stroke={accent} strokeWidth={0.7} opacity={0.22} fill="none" />

        <path d="M204 -26 l9 12 -9 12 -9 -12 Z" stroke={accent} strokeWidth={1.2} opacity={0.4} fill={wash} fillOpacity={0.25} />
        <path d="M195 -14 h18 M204 -26 v24" stroke={accent} strokeWidth={0.8} opacity={0.3} />
        <path d="M204 -2 q4 7 -2 11 q-4 4 0 9" stroke={accent} strokeWidth={0.9} opacity={0.3} fill="none" strokeLinecap="round" />
      </Layer>

      <Layer index={5}>
        <rect x={236} y={-62} width={22} height={22} rx={2} fill={accent} opacity={0.9} />
        <path d="M241 -55 h12 M241 -50 h12 M247 -58 v14" stroke={wash} strokeWidth={1.4} strokeLinecap="round" />
      </Layer>
    </>
  );
}

/**
 * Kyoto — a torii, the gates repeating behind it, a mountain, a lantern.
 *
 * The gate is drawn with its actual parts rather than as two posts and a bar:
 * the kasagi curving along the top, the shimaki under it, the nuki through the
 * pillars with its wedges, and the gakuzuka standing between them. That is what
 * separates a torii from a goalpost, and at this crop it is visible.
 *
 * A second gate stands behind at three-quarter size. One torii is a gate; two
 * is Fushimi, and the repetition is the thing people picture.
 */
function torii({ accent, wash }: MotifProps) {
  return (
    <>
      <Layer index={0}>
        {/* Filled, faintly. Drawn as open lines they read as zigzags rather
            than as something with a far side. */}
        <path d="M150 96 l58 -52 26 22 18 -16 68 46 Z" stroke={accent} strokeWidth={1.2} opacity={0.26} fill={accent} fillOpacity={0.05} />
        <path d="M0 96 l54 -40 28 24 22 -16 46 32 Z" stroke={accent} strokeWidth={1.2} opacity={0.18} fill={accent} fillOpacity={0.04} />
        <path d="M0 96 H320" stroke={accent} strokeWidth={1} opacity={0.35} />
      </Layer>

      <Layer index={1}>
        {/* Snow on the far ridge, and a treeline under it. */}
        <path d="M198 54 l10 -10 10 9" stroke={accent} strokeWidth={1.3} opacity={0.5} />
        {/* Mist lying in the folds, which is how these hills are always drawn
            and also what they actually do at dawn. */}
        <path d="M156 70 q34 -5 66 0 M206 58 q28 -4 54 0 M0 72 q30 -4 58 0" stroke={accent} strokeWidth={2} opacity={0.3} strokeLinecap="round" fill="none" />
        {/* Cedars, not tick marks: tall and narrow is what a Kyoto hillside does. */}
        <path d="M246 96 V80 M240 92 l6 -10 6 10 M242 86 l4 -7 4 7" stroke={accent} strokeWidth={1} opacity={0.3} fill="none" />
        <path d="M266 96 V76 M259 90 l7 -12 7 12 M261 83 l5 -8 5 8" stroke={accent} strokeWidth={1} opacity={0.26} fill="none" />
        <path d="M286 96 V82 M281 92 l5 -9 5 9" stroke={accent} strokeWidth={1} opacity={0.22} fill="none" />
      </Layer>

      <Layer index={2}>
        {/* The gate behind, three-quarter size. */}
        <path d="M214 96 V66 M242 96 V66" stroke={accent} strokeWidth={1.7} opacity={0.4} strokeLinecap="round" />
        <path d="M209 75 h38" stroke={accent} strokeWidth={1.3} opacity={0.4} />
        <path d="M204 66 q24 -6 48 0" stroke={accent} strokeWidth={2} opacity={0.4} strokeLinecap="round" />
        <path d="M226 66 V75" stroke={accent} strokeWidth={1.1} opacity={0.35} />
      </Layer>

      <Layer index={3}>
        {/* Footing stones. */}
        <path d="M90 96 h16 M170 96 h16" stroke={accent} strokeWidth={3} opacity={0.6} strokeLinecap="round" />

        {/* Pillars, nuki with its wedges, gakuzuka, shimaki, and the kasagi. */}
        <path d="M98 96 V44 M178 96 V44" stroke={accent} strokeWidth={3.2} strokeLinecap="round" />
        <path d="M88 62 h100" stroke={accent} strokeWidth={2.4} />
        <path d="M94 59 h8 v6 h-8 Z M174 59 h8 v6 h-8 Z" stroke={accent} strokeWidth={1} fill="none" opacity={0.7} />
        <path d="M134 50 h8 v12 h-8 Z" stroke={accent} strokeWidth={1.3} fill="none" opacity={0.8} />
        <path d="M82 50 h112" stroke={accent} strokeWidth={2.2} />
        <path d="M74 42 q64 -11 128 0" stroke={accent} strokeWidth={3.6} strokeLinecap="round" />
        <path d="M74 42 q-6 0 -9 -4 M202 42 q6 0 9 -4" stroke={accent} strokeWidth={2.6} strokeLinecap="round" />
      </Layer>

      <Layer index={4}>
        {/* A stone lantern, and the path going under the gate. */}
        <path d="M26 96 h22" stroke={accent} strokeWidth={2.4} opacity={0.65} strokeLinecap="round" />
        <path d="M37 96 V82" stroke={accent} strokeWidth={2} opacity={0.65} />
        <path d="M29 82 h16" stroke={accent} strokeWidth={1.6} opacity={0.65} />
        <path d="M31 82 V72 h12 v10" stroke={accent} strokeWidth={1.4} opacity={0.65} fill="none" />
        <path d="M34 77 h6" stroke={accent} strokeWidth={1.2} opacity={0.5} />
        <path d="M27 72 q10 -8 20 0" stroke={accent} strokeWidth={2} opacity={0.65} strokeLinecap="round" />
        <path d="M37 72 V66" stroke={accent} strokeWidth={1.4} opacity={0.6} strokeLinecap="round" />
        <path d="M104 104 h68 M96 112 h88" stroke={accent} strokeWidth={1.3} opacity={0.4} strokeLinecap="round" />
      </Layer>

      <Layer index={5}>
        {/*
          Opposite the branch, not behind it.

          It was moved left to clear the kasagi and then the bough was drawn
          through it. The sky has two corners: the blossom takes one and the
          sun takes the other.
        */}
        <circle cx={196} cy={-64} r={13} fill={accent} opacity={0.85} />
        <circle cx={196} cy={-64} r={19} stroke={accent} strokeWidth={1} opacity={0.3} fill={wash} fillOpacity={0.15} />

        {/*
          A bough leaning in over the gate.

          Blossom scattered through the sky looked like debris. On a branch it
          is a tree just out of frame, which is both more legible and more
          like standing under one.
        */}
        <path d="M0 -76 q56 4 92 24 q24 13 36 32" stroke={accent} strokeWidth={1.6} opacity={0.45} fill="none" strokeLinecap="round" />
        <path d="M44 -68 q8 -12 24 -14 M90 -52 q14 -8 30 -5 M118 -32 q10 -10 24 -10" stroke={accent} strokeWidth={1.1} opacity={0.35} fill="none" strokeLinecap="round" />
        <Blossom cx={70} cy={-83} r={4.2} accent={accent} opacity={0.5} />
        <Blossom cx={122} cy={-58} r={3.8} accent={accent} opacity={0.45} />
        <Blossom cx={144} cy={-42} r={4} accent={accent} opacity={0.4} />
        <Blossom cx={36} cy={-72} r={3.2} accent={accent} opacity={0.35} />
        {/* Two on their way down, from the branch rather than from nowhere. */}
        <Blossom cx={160} cy={-14} r={3} accent={accent} opacity={0.3} />
        <Blossom cx={186} cy={-36} r={2.6} accent={accent} opacity={0.25} />
      </Layer>
    </>
  );
}

/**
 * Seoul — hanok eaves in front, glass towers behind, a moon jar for a moon.
 *
 * The old roofline crosses in front of the new one because that is what the city
 * actually looks like from Bukchon, and because a language is learned in the
 * present tense.
 *
 * Two pieces of detail do the work here. The eaves get their tile courses — the
 * short ticks that make a giwa roof read as a roof rather than a curve — and the
 * front wall gets its lattice, which is the pattern anybody who has stood in a
 * hanok courtyard remembers before they remember the shape of the building.
 */
function hanok({ accent, wash }: MotifProps) {
  return (
    <>
      <Layer index={0}>
        <path d="M0 96 H320" stroke={accent} strokeWidth={1} opacity={0.35} />
        <path d="M196 96 V34 h18 v62 M220 96 V48 h14 v48 M242 96 V26 h20 v70 M268 96 V56 h16 v40 M290 96 V42 h18 v54" stroke={accent} strokeWidth={1.1} opacity={0.3} />
        {/* Namsan, with the tower on it — the shape that says this city from
            any direction. */}
        <path d="M104 42 q50 -38 102 0" stroke={accent} strokeWidth={1.4} opacity={0.3} fill={accent} fillOpacity={0.04} />
        <path d="M155 18 V-22 M148 -22 q7 -10 14 0 Z M150 -9 h10 M155 -22 V-40" stroke={accent} strokeWidth={1.3} opacity={0.35} fill="none" strokeLinecap="round" />
        <path d="M100 -46 q32 -7 66 -2 M146 -70 q36 -8 70 -2 M118 -18 q28 -6 56 -1 M8 -34 q26 -6 52 -1" stroke={accent} strokeWidth={1.1} opacity={0.13} strokeLinecap="round" fill="none" />
      </Layer>

      <Layer index={1}>
        {/* Window courses, which is all a glass tower is from this far away. */}
        <path d="M199 44 h12 M199 54 h12 M199 64 h12 M199 74 h12 M245 36 h14 M245 46 h14 M245 56 h14 M245 66 h14 M245 76 h14 M293 52 h12 M293 62 h12 M293 72 h12" stroke={accent} strokeWidth={0.8} opacity={0.25} />
      </Layer>

      <Layer index={2}>
        {/* The back eave, with its tile courses. */}
        {/* Higher and further right than the near eave, which is what puts it
            behind. Lower down it crossed in front of the roof it stands
            behind, and the two read as one tangled line. */}
        {/* Clear of the near eave in x as well as in height. Overlapping them
            put two curves through each other and read as one tangle. */}
        <path d="M146 74 q42 -20 84 0" stroke={accent} strokeWidth={2} strokeLinecap="round" opacity={0.7} />
        <path d="M146 74 q-6 -2 -10 -6 M230 74 q6 -2 10 -6" stroke={accent} strokeWidth={2} strokeLinecap="round" opacity={0.7} />
        <path d="M154 70 v-4 M166 66 v-4 M178 64 v-4 M190 64 v-4 M202 66 v-4 M214 70 v-4" stroke={accent} strokeWidth={0.85} opacity={0.32} />
        <path d="M156 74 V96 M220 74 V96" stroke={accent} strokeWidth={1.3} opacity={0.45} />
      </Layer>

      <Layer index={3}>
        {/* The near eave, lower and heavier, with rafter ends under it. */}
        <path d="M28 70 q52 -26 104 0" stroke={accent} strokeWidth={2.6} strokeLinecap="round" />
        <path d="M28 70 q-8 -2 -12 -8 M132 70 q8 -2 12 -8" stroke={accent} strokeWidth={2.6} strokeLinecap="round" />
        <path d="M34 66 v-4 M46 61 v-4 M60 58 v-4 M74 57 v-4 M88 58 v-4 M102 61 v-4 M116 66 v-4" stroke={accent} strokeWidth={1} opacity={0.5} />
        <path d="M32 73 q48 -23 96 0" stroke={accent} strokeWidth={1.1} opacity={0.45} />
        <path d="M38 72 l-4 6 M126 72 l4 6" stroke={accent} strokeWidth={1.2} opacity={0.5} />

        {/* Posts, and the lattice between them. */}
        <path d="M40 72 V96 M120 72 V96" stroke={accent} strokeWidth={1.8} />
        <path d="M52 96 V78 h56 v18" stroke={accent} strokeWidth={1.3} opacity={0.85} fill="none" />
        <path d="M66 78 V96 M80 78 V96 M94 78 V96 M52 84 h56 M52 90 h56" stroke={accent} strokeWidth={0.9} opacity={0.5} />
      </Layer>

      <Layer index={4}>
        {/* The moon jar, on the ground where it belongs. */}
        {/* In the foreground, where it is not standing in a tower's window. */}
        {/*
          No jar on the ground.

          It was tried against the towers and against the open ground and read
          as a bubble in both: a pale circle among rooflines competes with the
          moon above, and the drawing already has one circle. The moon is the
          moon jar — that is where the shape comes from.
        */}
        <path d="M0 108 h52 M8 114 h60" stroke={accent} strokeWidth={1.2} opacity={0.35} strokeLinecap="round" />
      </Layer>

      <Layer index={5}>
        {/* The moon, which is also the moon jar: that is where the shape of
            one comes from. */}
        <circle cx={194} cy={-62} r={15} fill={wash} stroke={accent} strokeWidth={1.6} />
        <path d="M183 -62 q11 -9 22 0" stroke={accent} strokeWidth={1} opacity={0.5} />

        {/* Two magpies. In Korea they are the birds that bring news. */}
        <path d="M126 -64 q6 -5 12 0 q6 -5 12 0" stroke={accent} strokeWidth={1.2} opacity={0.35} fill="none" strokeLinecap="round" />
        <path d="M166 -44 q5 -4 10 0 q5 -4 10 0" stroke={accent} strokeWidth={1.1} opacity={0.28} fill="none" strokeLinecap="round" />
      </Layer>
    </>
  );
}

/**
 * Hạ Long — a junk under limestone karsts, a sampan behind it, lotus on the water.
 *
 * The sails are the subject and keep the only heavy strokes. What they gained is
 * their battens: a junk rig is a sail divided by horizontal spars, and without
 * them the shape is just a triangle — with them it is unmistakably this boat.
 *
 * The karsts repeat the same shape at four sizes and three depths, which is
 * roughly what the bay does to anybody looking at it.
 */
function junk({ accent, wash }: MotifProps) {
  return (
    <>
      <Layer index={0}>
        <path d="M0 96 H320" stroke={accent} strokeWidth={1} opacity={0.35} />
        {/* One karst goes up past the old ceiling. They are vertical rock —
            a bay of them all the same height is a row of hills. */}
        <path d="M150 96 q18 -96 40 -96 t38 96 Z" stroke={accent} strokeWidth={1.2} opacity={0.16} fill={accent} fillOpacity={0.03} />
        <path d="M196 96 q14 -50 32 -50 t30 50 Z" stroke={accent} strokeWidth={1.2} opacity={0.22} fill="none" />
        <path d="M252 96 q10 -34 23 -34 t21 34 Z" stroke={accent} strokeWidth={1.2} opacity={0.18} fill="none" />
        <path d="M284 96 q8 -24 18 -24 t16 24 Z" stroke={accent} strokeWidth={1.2} opacity={0.15} fill="none" />
      </Layer>

      <Layer index={1}>
        <path d="M8 96 q10 -30 22 -30 t20 30 Z" stroke={accent} strokeWidth={1.3} opacity={0.3} fill="none" />
        <path d="M44 96 q7 -20 15 -20 t14 20 Z" stroke={accent} strokeWidth={1.3} opacity={0.24} fill="none" />
        {/* The scrub that grows on them, in three ticks. */}
        <path d="M24 70 l-3 -5 M30 67 l2 -6 M212 54 l-3 -6 M220 50 l2 -6" stroke={accent} strokeWidth={1} opacity={0.3} strokeLinecap="round" />
      </Layer>

      <Layer index={2}>
        {/* A sampan further out, which gives the junk its size. */}
        <path d="M232 90 h30 l-5 5 h-20 Z" stroke={accent} strokeWidth={1.2} opacity={0.4} fill="none" />
        <path d="M246 90 V74 M246 78 q10 4 9 12 h-9 Z" stroke={accent} strokeWidth={1.2} opacity={0.4} fill="none" />
      </Layer>

      <Layer index={3}>
        {/* Mainsail: battened, which is the whole character of a junk rig. */}
        <path d="M120 88 V24" stroke={accent} strokeWidth={2.2} strokeLinecap="round" />
        <path d="M120 28 q36 17 32 48 h-32 Z" fill={accent} fillOpacity={0.16} stroke={accent} strokeWidth={2} />
        <path d="M122 38 h18 M122 46 h23 M122 54 h27 M122 62 h29 M122 70 h30" stroke={accent} strokeWidth={0.9} opacity={0.55} />
        <path d="M120 24 q10 2 14 7" stroke={accent} strokeWidth={1.2} opacity={0.5} strokeLinecap="round" />

        {/* Foresail. */}
        <path d="M92 88 V42" stroke={accent} strokeWidth={1.9} strokeLinecap="round" />
        <path d="M92 46 q-24 13 -21 30 h21 Z" fill={accent} fillOpacity={0.12} stroke={accent} strokeWidth={1.8} />
        <path d="M90 56 h-14 M90 64 h-16 M90 72 h-17" stroke={accent} strokeWidth={0.85} opacity={0.45} />

        {/* Hull, with planking and a rudder. */}
        <path d="M64 88 h84 l-10 10 H74 Z" fill={accent} fillOpacity={0.2} stroke={accent} strokeWidth={2} strokeLinejoin="round" />
        <path d="M68 92 h76" stroke={accent} strokeWidth={0.9} opacity={0.5} />
        <path d="M148 88 l8 -6 M152 85 V96" stroke={accent} strokeWidth={1.4} opacity={0.7} strokeLinecap="round" />
      </Layer>

      <Layer index={4}>
        <path d="M24 104 q16 -6 32 0 t32 0" stroke={accent} strokeWidth={1.2} opacity={0.45} strokeLinecap="round" />
        <path d="M180 108 q16 -6 32 0 t32 0" stroke={accent} strokeWidth={1.2} opacity={0.35} strokeLinecap="round" />
        <path d="M96 114 q18 -6 36 0 t36 0" stroke={accent} strokeWidth={1.1} opacity={0.28} strokeLinecap="round" />
        {/* The lotus the drawing is named for. */}
        <path d="M276 104 q-9 -3 -9 -9 q6 -4 9 2 q3 -6 9 -2 q0 6 -9 9 Z" stroke={accent} strokeWidth={1.2} opacity={0.5} fill={wash} fillOpacity={0.5} />
        <path d="M268 110 q12 -4 24 0" stroke={accent} strokeWidth={1} opacity={0.35} strokeLinecap="round" />
      </Layer>

      <Layer index={5}>
        {/* Mist between the rocks, which is what the bay is famous for. */}
        <path d="M140 42 q40 -6 78 0 M194 22 q32 -5 62 0 M0 54 q34 -5 66 0" stroke={accent} strokeWidth={2.2} opacity={0.26} strokeLinecap="round" fill="none" />

        <path d="M118 -40 q6 -5 12 0 q6 -5 12 0" stroke={accent} strokeWidth={1.2} opacity={0.4} fill="none" strokeLinecap="round" />
        <path d="M158 -58 q5 -4 10 0 q5 -4 10 0" stroke={accent} strokeWidth={1.1} opacity={0.32} fill="none" strokeLinecap="round" />
        <path d="M136 -18 q4 -3 8 0 q4 -3 8 0" stroke={accent} strokeWidth={1} opacity={0.26} fill="none" strokeLinecap="round" />
      </Layer>
    </>
  );
}

const MOTIFS: Record<string, (props: MotifProps) => ReactNode> = { pagoda, torii, hanok, junk };
