# The Suboku system

The design language for Suboku Labs products. This one is a language-study app; the
system is meant to outlast it.

## The premise

**One canvas. One variable.**

The canvas is neutral — near-white or near-black, following the reader's own system
setting. The variable is a single accent hue. In this product the accent is what
distinguishes the four languages; in another it might distinguish nothing at all,
and the system still holds.

That is the whole of it. Everything below is a consequence.

### What this replaced, and why

The previous system, *Paper & Ink*, gave each language a fully realised palette
drawn from its material culture: sumi ink and cinnabar, washi and aizome indigo,
dancheong on hanji, sơn mài lacquer under gold leaf. Two were light, two were dark,
and the corner radii and type weights differed between them.

It was handsome and it was too much. Four palettes is four design systems to keep
honest, four sets of contrast ratios to verify, and a product whose character
changes depending on which language you happen to be studying. Reviewing it, almost
all of the identity was carried by the accent; the rest was decoration arranged
around it.

So the reduction kept the accent and dropped the rest. Four front ends survive —
they are simply four front ends that agree with each other.

## Principles

### 1. Take away before adding

Every element on a screen should have survived a question: what breaks if this is
removed? Three things failed that question during this redesign and were deleted
rather than restyled — a colour-coded chip next to a text label saying the same
thing, a stacked colour bar with a legend where a short sentence read better, and a
full-width slab of accent that had stopped being an accent by occupying a quarter
of the canvas.

### 2. Space separates; lines almost never do

An earlier version boxed every group in a bordered panel, and each screen became a
stack of rectangles with no hierarchy. Everything equally important is the same as
nothing being important. `Card` is now reserved for the single thing on a screen you
act on, and it is a tint rather than an outline.

### 3. Colour must carry information

Colour that restates a label is decoration. Two uses earned their place, and both
pass the same test — *removing this removes meaning, not ornament*:

- **Tone ramps.** On a tone card the colour **is** the answer.
- **Grade colours.** Again and Easy have to be distinguishable under a thumb,
  mid-session, without reading.

Everything else is ink, muted ink, or faint ink.

### 4. One question per screen

The dashboard answers "is there anything to study?" Review answers "what is this
word?" Progress answers "how am I doing?" Anything answering a different question
belongs on a different screen, one tap away.

### 5. Motion explains; it does not entertain

Every animation encodes where something came from or where it went. The test: *if
this were removed, would the interface become harder to follow?* If not, it should
not have been added.

### 6. Nothing is mandatory

Every motion honours the system reduce-motion setting and resolves instantly to its
end state. Nothing is hidden behind a transition that never plays.

## Palette

Shared, in both modes: canvas, surface, surface-raised, line, ink, ink-muted,
ink-faint, plus the semantic set (positive, caution, critical) and the four grade
colours. Defined once, tested once.

Per language, one accent:

| Language | Accent |
| --- | --- |
| Mandarin | Cinnabar |
| Japanese | Indigo |
| Korean | Celadon |
| Vietnamese | Ochre |

Held at comparable lightness so the four feel like one product rather than four
skins. The primary action is **ink**, not accent — the accent appears in links,
progress fills, tone marks and the language dot, where it distinguishes something.

Neutrals are slightly warm rather than pure grey. A true `#FFFFFF`/`#000000` pair
reads as a spec sheet, and these are surfaces meant to be looked at for an hour at a
time.

### Verified, not eyeballed

`packages/core/src/theme/palettes.test.ts` asserts, across all four languages and
both modes: body text at WCAG AA on canvas and surface, muted and faint text above
their thresholds, the accent legible as text, the accent's own label legible on top
of it, every grade colour legible and mutually distinct, and every tone colour
legible and mutually distinct.

One test is the system's own guardrail: **nothing varies between languages except
the accent and the tone ramp.** If a second field ever starts varying, that test
fails and the system has quietly become four systems again.

Two palettes were caught by these tests rather than by looking: Vietnamese ochre at
`#A9762A` put white button text at 3.95:1, under the 4.5:1 bar, and was darkened;
and in the previous system Mandarin's tones 1 and 4 resolved to the same red, which
would have silently broken the tone exercise.

## Type and shape

| Token | Size |
| --- | --- |
| Target text | 46 / 28 |
| Display (the one big number) | 68 |
| Title | 22 |
| Heading | 17 |
| Body | 15 |
| Caption | 13 |
| Micro | 11 |

Target-language text is set large deliberately: tone marks, kanji strokes and the
hỏi/ngã distinction do not survive body size, and a learner squinting at a diacritic
is not studying it.

Three weights — 400, 500, 600 — not five. Hierarchy comes from size and space;
adding weight on top of both is what makes an interface look busy while every
individual decision seemed reasonable.

Spacing runs 4 / 8 / 12 / 20 / 28 / 44. One radius scale for the whole product:
14 for surfaces, 10 for controls. Pill radius survives only for the progress track,
where it is a capsule rather than a decision.

## Motion

Springs, not eased curves, for anything with mass — a spring settles the way an
object settles. Fades still use a bezier; light has no mass. Nothing exceeds 340ms:
on a screen visited forty times a day, longer stops being polish and becomes a
queue.

| Pattern | What it encodes |
| --- | --- |
| **Press-scale** | The tap landed, before any state has changed. Without it a slow action reads as a missed tap and gets pressed twice. |
| **Staggered rise** | Reading order. Tells you where to look first without anything being louder. |
| **Count roll-up** | Draws the eye to the one number the dashboard exists to deliver, and makes a changed count noticeable on return. |
| **Card deal** | Direction of the grade you gave — Again and Hard lean left, Good and Easy right. The only feedback distinguishing a grade you meant from one you mis-tapped. |
| **Reveal** | The answer rises into place, so the eye follows content rather than re-finding it. |
| **Progress fill** | Tight spring, no overshoot. A bar that bounces past its value is lying for a few frames. |
| **Celebration** | One bouncy pop, at the end of a session. The only one, which is why it still works. |

Deliberately absent: no screen-transition choreography beyond the platform default,
no skeleton shimmers, no looping or idle animation. Nothing moves unless you did
something.

### On sourcing

An earlier request asked for motion patterns from Mobbin. Mobbin is login-gated — a
direct fetch returns 403 — so nothing here was taken from it. These are the patterns
it catalogues, implemented from the conventions themselves. Every timing lives in
`src/motion/tokens.ts` if a specific reference needs matching.

## Where things live

```
packages/core/src/theme/     the palettes, as data — shared with the native widgets
apps/mobile/src/theme/       layout tokens and the theme provider
apps/mobile/src/motion/      tokens and the motion primitives
```

The palettes are in core rather than the app because the home-screen widgets render
in their own processes, in Swift and Kotlin. Defining colours there too would mean
each palette existing three times and drifting in two of them. Instead both modes
travel in the widget payload and the native code picks with its own environment —
so a widget follows the home screen's appearance, not whichever mode the app was
last in.
