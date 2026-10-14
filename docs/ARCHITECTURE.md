# Architecture

## The one rule

`packages/core` imports nothing from React, React Native or the DOM. Everything about
scheduling, exam curricula, session composition, statistics and theming lives there as
plain TypeScript.

That constraint is what makes "four front ends, one backend" true rather than
aspirational. There are five renderers in this repo — the web app, the iOS app, the
Android app, the WidgetKit extension and the Glance widget — and none of them contains a
scheduling decision. When the Vietnamese widget and the Vietnamese app show a different
interval for the same card, that is a bug with one place to look.

## Layers

```
                    ┌─────────────────────────────────┐
                    │      @mon/core          │
                    │  exams · srs · session · stats   │
                    │  theme · widget payload · data   │
                    │      StudyEngine (facade)        │
                    └───────────────┬─────────────────┘
                                    │ KeyValueStore port
                    ┌───────────────┴─────────────────┐
                    │        apps/mobile              │
                    │  expo-router screens, themed     │
                    │  AsyncStorage adapter            │
                    └───────┬─────────────────┬───────┘
                            │                 │ widget payload (JSON)
                  iOS / Android / web     ┌───┴────────────────┐
                                          │  WidgetKit (Swift) │
                                          │  Glance (Kotlin)   │
                                          └────────────────────┘
```

### `StudyEngine`

The single API the app talks to. It owns loading, scheduling, grading, statistics and
widget payloads, and it takes a `KeyValueStore` rather than knowing about storage.

Mutable by design: the React layer holds a `revision` counter that increments on every
change and re-reads what it needs. The alternative — mirroring domain state into a React
store — means two representations that can disagree.

### The storage port

One interface, `get`/`set`/`remove`. AsyncStorage backs it on all three platforms; tests
use an in-memory `Map`. Corrupt stored values fall back to defaults rather than failing
at launch: losing a preference is recoverable, failing to start is not.

## Scheduling

FSRS-4.5 with the published default weights, plus Anki-style learning steps for
same-day intervals and standard interval fuzz.

`srs/fsrs.ts` is the memory model as pure functions and nothing else, so it can be
checked against the reference implementation line by line. Everything calendar-shaped —
learning steps, fuzz, leeches, exam pressure — lives in `srs/scheduler.ts`.

### Exam pressure

The app-specific part. Ordinary FSRS optimises for durable knowledge on an open-ended
horizon, which is the wrong objective when there is a paper on a known date.

Inside a 60-day ramp window, target retention rises towards 97% and intervals are capped
at 80% of the days remaining — so every card gets another showing *before* exam day, with
slack, rather than everything landing on it. Outside the window scheduling is ordinary
FSRS: cramming three months early costs reviews and buys nothing.

## Sessions

Three rules, in precedence order:

1. Learning and relearning cards that are due go first — they are on minute-scale
   intervals and delaying them wastes the step ladder.
2. Reviews are ordered by **risk**, not by due date: current recall probability, or with
   an exam booked, recall *projected to exam day*. Those orderings differ meaningfully —
   a card at 95% today with low stability will be well below a card at 80% with high
   stability by the time the paper is in front of you.
3. New and review cards are interleaved by largest deficit against the level's card
   weights, so the mix approximates the real paper. Kinds with no cards left are skipped
   and the rest re-normalise, so a session degrades to the right mix of what is available
   rather than refusing to fill.

Daily caps are computed from the review log rather than a counter, so they stay correct
across two devices and across grades made on the home screen while the app was closed.

## Cards

A **lexical entry** is a word. A **card** is one prompt about it — recognition,
production, listening, reading, writing, grammar, tone, script — each with independent
memory state, because recognising 書く is a different memory from producing it.

Card ids are derived as `entryId:kind`, not generated. Regenerating after a level's
weights change is therefore idempotent: existing cards keep their review history instead
of being duplicated under fresh random ids.

Which kinds exist for an entry is the intersection of what the exam level weights and
what the entry can support. A tone card for a Japanese noun, or a cloze card for an entry
with no example sentences, cannot be answered — those are filtered out at generation
rather than papered over in the UI.

## Themes

Four palettes in `core/theme/palettes.ts`, one per language, as data.

They are in core rather than the app because the widgets render in their own processes
in Swift and Kotlin. Defining palettes there as well would mean each theme existing three
times and drifting in two of them. Instead the theme travels in the widget payload and
the native code renders what it is given.

Two things are stated explicitly per theme rather than derived from the semantic colours,
and both were bugs before they were rules:

- **Tone ramps.** On a tone card the colour *is* the answer, so two tones sharing a hue
  is a broken exercise. Deriving from semantic roles collided, because a palette
  legitimately reuses a hue across roles.
- **Card-kind colours.** The dashboard legend shows kinds side by side with a coloured
  dot to tell them apart. The derived mapping rendered "Meaning" and "Listening" in the
  same indigo in the washi theme.

`palettes.test.ts` asserts WCAG contrast for body text, muted text, tone ramps and kind
colours against each theme's own background and surface, and asserts distinctness within
each ramp. Four hand-picked palettes is exactly the situation where one quietly ends up
with grey-on-grey text, and the type system cannot catch it.

## The widget boundary

Covered in [WIDGET.md](WIDGET.md). The short version: the payload is flat, every string
is pre-formatted, and the only thing travelling back is `{cardId, rating, gradedAt}`.
