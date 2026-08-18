# language-srs

Exam-aligned spaced repetition for **Mandarin, Japanese, Korean and Vietnamese**, with
home-screen widgets. One shared core, running natively on iOS and Android and as a
static web app — from a single codebase.

A [Suboku Labs](https://github.com/suboku-labs) product, built on the Suboku design
system: one neutral canvas, one accent, and nothing on screen that has not earned its
place. See [docs/DESIGN.md](docs/DESIGN.md).

## What makes it exam-shaped

Most SRS apps are a word list with a scheduler bolted on. This one is built around the
paper you are actually sitting.

- **Real exam models.** HSK 3.0 (nine levels) and HSK 2.0 (six), JLPT, TOPIK I/II, and
  the Vietnamese MOET six-level framework — each with its sections, question counts,
  durations, pass marks and sectional minimums.
- **Sessions that mirror the paper.** Every level declares how much weight each card
  kind deserves, and the session builder composes the queue to match. A JLPT session
  contains no handwriting cards, because the JLPT has no writing section. A TOPIK II
  session is production-heavy, because that paper ends in a long composition.
- **Exam-date-aware scheduling.** Set a date and the scheduler raises its retention
  target and caps intervals as the exam approaches, so nothing is scheduled to land
  after the paper.
- **Honest readiness.** Recall is projected forward to exam day assuming *no further
  reviews* — the number tells you what would happen if you stopped today, rather than
  counting scheduled-but-undone work as knowledge.

## Four languages, one surface

The canvas is the same everywhere — near-white or near-black, following the reader's
system setting. A language changes exactly one thing: its accent.

| Language | Accent |
| --- | --- |
| Mandarin | Cinnabar |
| Japanese | Indigo |
| Korean | Celadon |
| Vietnamese | Ochre |

An earlier version gave each language a fully realised palette drawn from its material
culture. It was handsome and it was four design systems to keep honest — so it was
reduced to the part that was actually carrying the identity. A test asserts that
nothing except the accent and the tone ramp varies between languages, so it cannot
quietly become four systems again.

The palettes live in `@language-srs/core` as data, not in the React layer, so the app
and both native widgets render one definition. The widget payload carries *both* modes,
letting the home screen follow its own appearance rather than whichever mode the app
was last in.

Tone ramps are the exception that proves the rule about colour: each syllable of a
Mandarin or Vietnamese word is coloured by its tone, because on a tone card the colour
**is** the answer. Those ramps are stated explicitly per language and tested for
distinctness and contrast — deriving them from the semantic palette collided, and
silently broke the exercise.

## Layout

```
packages/core/            @language-srs/core — all the domain logic, no React or DOM
  exams/                  HSK, JLPT, TOPIK and Vietnamese curricula
  srs/                    FSRS-4.5 scheduler + exam-date pressure
  session/                queue building, daily caps, exam-weighted card mix
  stats/                  streaks, true retention, coverage, exam readiness
  theme/                  the Suboku palettes
  widget/                 the widget payload contract and deep links
  data/                   seed decks and the bulk importer
  engine.ts               the single API the app talks to

apps/mobile/              Expo app: iOS, Android and web from one codebase
  app/                    expo-router screens
  modules/widget-bridge/  native module: shared container + widget reload
  targets/ios-widget/     WidgetKit sources (Swift)
  targets/android-widget/ Glance sources (Kotlin)
  plugins/withWidgets.ts  config plugin wiring both native widget targets
```

The split is the point: `packages/core` imports nothing platform-specific, so the
scheduling behaviour on the web, on both phones, and on the home screen is the same
code. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Running it

```bash
npm install

npm test          # unit tests over the core domain
npm run typecheck # core + app

npm run web       # dev server in the browser
npm run web:build # static export to apps/mobile/dist
```

### Deploying the web build

Pushing to `main` builds and publishes to GitHub Pages via
`.github/workflows/deploy-pages.yml`. To preview a branch before it merges, run
that workflow manually from the Actions tab with the branch selected.

**One-time setup:** in *Settings ▸ Pages*, set **Source** to **GitHub Actions**.
Until that is done the workflow runs green but publishes nothing.

Two details the build handles that catch most static exports on Pages:

- A project site is served from `/<repo>/`, not the domain root, so the build sets
  `EXPO_WEB_BASE_URL=/language-srs` and Expo prefixes every asset and route. It is
  read from the environment rather than hard-coded so `npm run web` still works at
  the root locally.
- Pages runs Jekyll, which drops anything whose name starts with an underscore —
  including Expo's entire `_expo/` bundle directory. The build writes `.nojekyll`
  to disable that, plus a `404.html` so unknown URLs land in the app rather than
  on GitHub's error page.

Build it locally exactly as CI does:

```bash
npm run web:pages   # writes apps/mobile/dist, ready to serve at /language-srs/
```

Native builds need a Mac with Xcode (iOS) or Android Studio:

```bash
npm run prebuild  # generate ios/ and android/, including the widget targets
npm run ios
npm run android
```

`ios/` and `android/` are generated and not committed — the Swift and Kotlin sources
live in `apps/mobile/targets/` and are copied in by the config plugin, so
`expo prebuild --clean` never loses them.

## Home-screen widgets

Both platforms get a widget that shows the next card and grades it **without opening
the app** — an App Intent on iOS 17+, a Glance action callback on Android. When nothing
is due it shows a word you have met before and are drifting away from, rather than a
zero.

The governing rule is that **the widget renders, it does not compute**. The app writes a
fully-formatted snapshot — including the intervals on the grade buttons and the theme —
into a shared container, and the native code only lays it out. A grade tap is recorded
as an intent and replayed through the real FSRS implementation next time the app runs,
so there is exactly one scheduler rather than three that disagree.

Details, including the iOS target setup and how to verify the wiring:
[docs/WIDGET.md](docs/WIDGET.md).

## Vocabulary

The app ships a starter deck per language (~30 entries each) covering the first level of
each track and exercising every card kind, including tone drills and script drills. It
is a starting point, not a syllabus — full official word lists are imported:
[docs/DATA.md](docs/DATA.md).

## Accuracy of the exam data

Where a body publishes official numbers, the app uses them and says so. Where it does
not, the app says that too rather than implying precision it does not have:

- **HSK** publishes official word and character lists. Targets are exact.
- **JLPT** stopped publishing lists with the 2010 revision. Vocabulary and kanji counts
  are widely-cited community estimates; pass marks and sectional minimums are official.
- **TOPIK** has never published word lists. Format, durations and level cut-offs are
  official; vocabulary counts are estimates.
- **Vietnamese** MOET defines levels by descriptor, not by vocabulary. Targets are
  inferred from the CEFR band, and section durations vary between accredited centres.

Each track carries a `targetsAreOfficial` flag and a `source` string, and the UI labels
estimated coverage as estimated.
