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
                    │      @language-srs/core          │
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

Four palettes in `core/theme/palettes.ts`, one per language, as data — but they share
one ground, one grade scale and one geometry, and differ only in a single accent. The
earlier per-language rooms (two dark, two light, four radii) are gone: they made
switching language feel like switching apps.

They are in core rather than the app because the widgets render in their own processes
in Swift and Kotlin. Defining palettes there as well would mean each theme existing three
times and drifting in two of them. Instead the theme travels in the widget payload and
the native code renders what it is given.

Two things are stated explicitly rather than derived from the semantic colours, and both
were bugs before they were rules:

- **Tone ramps.** On a tone card the colour *is* part of the answer, so two tones sharing
  a hue is a broken exercise. Deriving from semantic roles collided, because a palette
  legitimately reuses a hue across roles.
- **Card-kind colours.** The dashboard's mix bar shows kinds side by side with nothing
  but colour to tell them apart. The derived mapping rendered two kinds in the same hue.

`palettes.test.ts` asserts WCAG contrast for body text, muted text, accents, grade
labels, tone ramps and kind colours, asserts distinctness within each ramp, and asserts
that the ground, the grade scale and the geometry are identical across the four. That
last group is what stops the heavy version growing back one palette at a time.

## Accounts

Three layers, and the split matters:

- **`core/auth/`** holds the contract — the wire types, the email and password
  rules, and the state-sync envelope. It is imported by both sides, so a rule
  cannot be enforced by the server and described differently by the form.
- **`apps/server/`** implements it over `node:http` with no runtime dependencies.
  Details and the security reasoning: [API.md](API.md).
- **`apps/mobile/src/auth/`** holds the client, the stored session and the sync
  loop.

The engine knows nothing about any of it. What signing in actually does is swap
the storage namespace underneath the domain: `PrefixedStore` puts every key under
`acct:<id>:`, so two accounts on one device are two separate stores rather than
one store with an owner column. The signed-out namespace is the empty prefix —
where the app wrote before accounts existed, which is what makes studying first
and signing up later lose nothing.

Two guards keep that boundary honest, and both were bugs first:

- `EngineProvider` withholds its context while the account and the open engine
  disagree. React runs child effects before parent ones, so without it there is
  one render where the new account is signed in and the previous engine is still
  mounted — long enough for the sync loop to write one account's cards into
  another's storage.
- `SyncProvider` refuses to sync when `accountId !== user.id`, which is the same
  check from the other end.

## Study sittings

`core/sessions/` turns gradings into sittings. A `ReviewLog` is the right grain
for the scheduler and the wrong one for a person: nobody asks how many gradings
they made on Tuesday, they ask how long they sat down for and how often.

Sittings are recorded by the app — only it knows when a session was abandoned
rather than finished — and reconstructed from review logs when there are none,
which covers history from before sittings existed and gradings made on the
widget. Reconstructed ones are marked `derived` and labelled as approximate in
the UI.

## Teachers and practice

`core/teachers/` holds four characters — portrait glyph, method, principles, lines — and
`core/practice/` holds the tone inventories and the two answer checks (`checkWrittenAnswer`,
`checkTonePattern`).

Both are in core for the same reason as everything else here: they are statements about
the language rather than about the screen, they need testing against real entries, and
the web build and the two native builds must not disagree about whether an answer was
right. The checks deliberately do not grade — see `check.ts` for why an automatic
"wrong, therefore Again" would corrupt the schedule.

## The widget boundary

Covered in [WIDGET.md](WIDGET.md). The short version: the payload is flat, every string
is pre-formatted, and the only thing travelling back is `{cardId, rating, gradedAt}`.
