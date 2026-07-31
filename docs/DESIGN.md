# Paper & Ink — the design language

## Why this one

Every palette in the app references a physical writing surface, because that is
what learning these four languages has always physically involved: paper, ink,
a seal, a brush.

So the design language is: **the app behaves like paper and pigment.** Surfaces
are sheets. Colour is pigment, applied where it means something. Cards are
objects you pick up, put down and deal off a deck.

That gives the interface a consistent answer to "how should this behave?" that
does not need a designer in the room for every new screen.

## One room, four inks

The first version of this took the metaphor too far and gave each language its
own room: sumi ink on a dark ground for Mandarin, washi and indigo for Japanese,
dancheong on hanji for Korean, lacquer and gold leaf for Vietnamese. Two dark
themes, two light, four corner radii, four grade scales.

It photographed well and it was heavy to use. Switching language turned the
lights off. Corner radii moving from 4pt to 16pt made the same component look
like a different component. Anyone studying two languages was using two apps.

What was actually worth keeping was the *reference*, not the whole room. So the
palettes now share one warm near-white ground, one ink for text, one grade
scale, one geometry — and each language keeps a single accent: cinnabar, indigo,
celadon, gold leaf. Switching language changes the colour of the pen.

The rule this leaves behind: **a language may change what colour the app writes
in; it may not change how the app is built.** `palettes.test.ts` asserts exactly
that, so it cannot drift back.

## The five principles

### 1. Surfaces are sheets, not boxes

A sheet is separated from what is under it by tone and shadowless depth, not by
an outline. An earlier version of this app boxed every group in a bordered panel,
and the dashboard became six rectangles with no hierarchy — everything equally
important is the same as nothing being important.

So: whitespace first, tint second, border almost never. `Card` is reserved for
the one thing on a screen you are meant to act on.

### 2. Ink is expensive

Colour marks meaning. It is never decoration and never mood.

In practice this means one filled control per screen — the primary action — and
everything else in text. It also means colour that carries information is held to
a standard: tone colours and card-kind colours are asserted for contrast and
mutual distinctness in `packages/core/src/theme/palettes.test.ts`, because on a
tone card **the colour is the answer**.

### 3. One question per screen

The landing page answers "what is this, and who teaches it?" The dashboard
answers "is there anything to study?" Review answers "what is this word?"
Progress answers "how am I doing?" Anything that answers a different question
belongs on a different screen, one tap away.

This is also why the app has a front door at all. Opening straight onto a
dashboard answers the second question to somebody who has not been asked the
first, and buries language switching behind a chevron on a screen that is about
something else.

### 4. Motion explains; it does not entertain

Every animation in the app encodes where something came from or where it went. The
test each one is written against: *if this animation were removed, would the
interface become harder to follow?* If not, it should not have been added.

This rules out the things that make apps feel expensive and behave worse —
decorative loading shimmers, parallax, bouncing icons, anything that puts a
duration between a tap and its result.

### 5. Nothing is mandatory

Every motion respects the system's reduce-motion setting via Reanimated's
`ReduceMotion.System` and `useReducedMotion()`. Under reduced motion, animations
resolve instantly to their end state — nothing is hidden behind a transition that
never plays.

## Type and shape

| Token | Value | Note |
| --- | --- | --- |
| Target text | 44 / 30pt | Large on purpose: tone marks and the hỏi/ngã distinction do not survive body size. |
| Title | 24pt | Weight and letter spacing come from the theme. |
| Heading | 18pt | |
| Body | 15pt | |
| Caption | 13pt | |
| Micro | 11pt | Section labels, in uppercase with wide tracking. |

Spacing runs 4 / 8 / 12 / 16 / 24 / 32. Corner radii still come from the theme
rather than from a global token — the native widgets read them out of the same
payload — but all four themes now declare the same values: 14pt for a card, 10pt
for a control, fully round for a pill.

## The teachers

Four characters, one per language, defined as data in
`packages/core/src/teachers/`. Each has a portrait glyph, a method, three
principles and a short set of lines.

Three rules keep them from becoming a mascot:

1. **They stand for a position.** Lín Mò pulls characters apart because that is
   how hanzi are learned; Cô Mai leads with the ear because Vietnamese tone
   contrasts are inaudible until they are trained. The character is a way of
   stating the pedagogy, not a face on top of it.
2. **A monogram, not an illustration.** One character from the teacher's name,
   set in that language's accent on a wash of it — the same idea a seal or a
   signature block already is in all four writing traditions. Four drawn faces
   would date in a year and would have to be redrawn for every new language.
3. **They speak once per moment, and quietly.** One muted line, no bubble, no
   avatar animation. `teacherLine()` is seeded rather than random, because a line
   chosen with `Math.random()` changes on every re-render and the teacher appears
   to stammer whenever anything else on screen updates.

## Motion

### On sourcing

Mobbin is login-gated — a direct fetch returns 403 — so nothing here was taken
from it. What follows are the patterns Mobbin catalogues, implemented from the
conventions themselves: the shared vocabulary you see across Duolingo, Things,
Headspace, Linear and the iOS and Material motion guidelines. If you have a Mobbin
subscription and want a specific app's timing curve matched, that is a
straightforward change — every value lives in `src/motion/tokens.ts`.

### The tokens

Springs, not eased curves, for anything that moves. A spring settles the way an
object settles; a card that decelerates on a bezier reads as a sprite rather than
a sheet of paper. Fades still use a bezier — light has no mass.

```
spring        damping 18, stiffness 220   the house spring
springTight   damping 26, overshoot off   progress fills and anything read as a value
springBouncy  damping 11, stiffness 180   the one celebratory beat
```

Durations top out at 340ms. Anything longer, on a screen you visit forty times a
day, stops being polish and becomes a queue.

### The patterns

**Press-scale** — `Press`, in `src/motion/components.tsx`. Every tappable drops to
0.965 in 90ms and springs back. The cheapest and most valuable animation in the
app: a control that moves under your thumb confirms the tap landed before any
state has changed. Without it, a slow action reads as a missed tap and gets
pressed twice.

**Staggered rise** — `Rise`. Content fades up 14pt, 45ms apart between siblings,
so a screen resolves top to bottom in the order you would read it. The ordering is
the point: it tells you where to look first without anything having to be bigger
or brighter than it deserves.

**Count roll-up** — `CountUp`. The dashboard's waiting count rolls from zero over
~520ms. It draws the eye to the number the whole screen exists to deliver, and
makes a changed count noticeable when you come back.

**Card deal** — `DealtCard`. The signature interaction. After you grade, the next
card rises from beneath and settles, offset in the direction of the grade you gave
— Again and Hard lean left, Good and Easy lean right. This is the only feedback
that distinguishes a grade you meant from one you mis-tapped, and it arrives
before the next card has rendered, so a wrong tap is obvious immediately rather
than one card later.

**Reveal** — the answer rises into place rather than the card snapping to a new
height, so the eye follows the content instead of re-finding it.

**Progress fill** — `AnimatedFill`, on the tight spring. No overshoot: a progress
bar that bounces past its value and back is lying for a few frames.

**Theme cross-fade** — `ThemeFade`. Switching language re-tints everything the
accent touches at once. Now that the ground is shared this is a smaller move than
it was, but an instant swap of every accent on screen still reads as a glitch,
and a 340ms fade reads as the app changing pens.

**Celebration** — `PopIn` on the bouncy spring, used once: the end-of-session
panel. One moment in the app where a little celebration is the correct response,
and it stays effective because it is the only one.

### What is deliberately absent

- No screen-transition choreography beyond the platform default. The native
  push/pop is what users already know.
- No skeleton shimmers. The app loads from local storage; a shimmer would be
  theatre for something that takes a frame.
- No looping or idle animation anywhere. Nothing moves unless you did something.

## Where things live

```
src/motion/tokens.ts       springs, durations, easing, distances
src/motion/components.tsx  Rise, Press, CountUp, AnimatedFill, DealtCard, PopIn, ThemeFade
src/components/Teacher.tsx portrait, name and line
src/components/Practice.tsx the tone drill, the typed answer, the verdict
src/theme/                 layout tokens + the theme provider
packages/core/src/theme/   the shared ground and the four inks, as data
packages/core/src/teachers/ the four characters, as data
```

Motion primitives take no colours and no layout opinions — they wrap children and
animate them — so any screen can adopt one without inheriting a look.
