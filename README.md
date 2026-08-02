# language-srs

Exam-aligned spaced repetition for **Mandarin, Japanese, Korean and Vietnamese**, with
home-screen widgets. One quiet interface, four teachers, running natively on iOS and
Android and as a static web app — from a single codebase.

## The shape of it

The app opens on a **landing page**, every time. It holds the four languages, says how
each one is taught and by whom, and nothing else. Choosing a language pushes you into
that language's dashboard; coming back out is one tap on the teacher's portrait. There
is one front door rather than a picker hidden behind the screen you happened to leave
open.

Past the door it is a flashcard app: a count, a button, and cards.

## Four teachers

Each language is taught by a named character with a stated method, because "how is this
taught?" is a better question for a landing page to answer than "which four languages
are supported?".

| Language | Teacher | Their method |
| --- | --- | --- |
| Mandarin | 林墨 · Lín lǎoshī | Components before characters; the tone drilled as part of the word. |
| Japanese | 森 葵 · Mori-sensei | Kana until invisible, then kanji through the words that use them. |
| Korean | 서하은 · Seo seonsaengnim | Hangul as a machine — parts, blocks, then the endings that carry meaning. |
| Vietnamese | Cô Mai | Six tones by ear first, drilled as minimal pairs. |

They live in `@language-srs/core` as data — a portrait glyph, a method, three
principles and a handful of lines — so the teacher who greets you on the dashboard is
the same one who closes the session and the same one the landing page introduced. They
are not decoration: each stands for a real pedagogical position, and that position is
what the sessions are built around.

## Cards you can answer

Most cards are recall-then-self-grade, which is right for a flashcard and useless for
catching the two mistakes that matter most in these four languages. So two kinds are
answered rather than revealed:

- **Tone cards** give you a slot per syllable and the language's own tones as buttons —
  ā á ǎ à and the neutral for Mandarin, ngang through nặng for Vietnamese. Tap them in
  order and the card tells you which syllable you missed.
- **Production cards** are typed. Typing the reading where the characters were asked for
  gets its own answer rather than being marked wrong, and so does the right word with
  the wrong diacritics — "close" is a real verdict, because on `hỏi` versus `hoi` it is
  the truthful one.

The check never grades. FSRS is driven by your own judgement of recall, and an automatic
"wrong, therefore Again" would mis-schedule every answer that was right but mistyped.
What the check does is reveal the card, say something specific about what happened, and
outline the grade it would suggest.

## The words are the syllabus

Every level carries the examining body's own vocabulary, not a sample deck: **14,093
words**, generated from the published lists by `tools/vocab/build.mjs` and committed.
HSK's list is official and exact. The JLPT stopped publishing in 2010, so Japanese uses
the community reconstruction everybody uses. TOPIK has never published one, so Korean
levels are derived from the TOPIK and National Institute bands. Vietnamese has no list to
derive from at all, so its levels are frequency bands — which is what the app already
said it was doing.

Tones are read off the spelling rather than trusted to a source: numeric pinyin for
Mandarin, and the diacritics for Vietnamese, decomposed and read mark by mark. The tone
drill is the one exercise where missing data teaches the opposite of the truth.

**The words are served, not shipped.** They used to be compiled into the app — 1.7MB sent
to a phone on install and again on every update — which was most of a 4.1MB bundle. The
API serves them a level at a time now, cached on the device against a version that is a
hash of the dataset, and the bundle is 2.2MB. A learner on HSK 2 downloads two levels,
not nine; a device that already has them asks and gets a 304. With no server reachable
the app falls back to a bundled starter deck and still works.

Cards are made for a sliding window of about two hundred words ahead of you rather than
for the whole syllabus at once — HSK 6 in scope is three thousand words, and nobody needs
ten thousand cards in their pocket to study fifteen a day. Sources, licences and the
derivations are in [docs/DATA.md](docs/DATA.md).

## Seeing the words

The vocabulary has its own screen, and it answers two questions with two pictures.

**This level** is every word in the level as a grid of chips, each tinted along one
gradient from just-met to known. That is deliberately not a table: a table of target,
reading, gloss and interval is a spreadsheet, and nobody scans a spreadsheet to find out
how they are doing. A field of colour has the one property the table cannot — you can see
the *shape* of a level at a glance, and a red speck in it tells you where something is
going wrong. Tap a word and it opens in place with its reading, gloss, an example and
what the scheduler thinks of it. The counts double as filters, and the sort flips between
syllabus order and weakest first.

**All levels** is one row per level of the track, with the same colours as a single bar.
It is computed from cards and the manifest alone, so a nine-level track costs nine
numbers rather than five thousand entries; opening a level is what downloads it. Which
means you can look at HSK 7-9 while studying HSK 2, and looking does not start scheduling
it.

A word's state is the **weakest of its cards**, not the average. If you can recognise a
word but cannot produce it, you do not know it yet — and an average would report you
three-fifths of the way there, which is a number that flatters and says nothing about
what to do next. Strength is log-scaled against the maturity threshold, because the
distance from one day to one week is a real achievement and the distance from eighty days
to ninety is not.

## Accounts, and what a session means

Studying works signed out, on the device, as it always has. An account adds three
things, which are the three meanings of "session tracking" this app cares about:

- **Study sessions.** Every sitting is recorded — when it started and ended, how
  many cards, how many recalled, on which device — so the account screen can
  answer "how much have I actually been studying?" with sittings rather than a
  streak. History from before sessions existed is reconstructed from the review
  log and labelled as reconstructed.
- **Auth sessions.** You stay signed in across launches on a sliding thirty-day
  token; the account screen lists every signed-in device, and any of them can be
  revoked from any other.
- **Per-account separation.** Two people sharing a device get separate decks,
  schedules, streaks and histories. Signing in swaps the storage namespace under
  the domain rather than filtering it, so nothing bleeds between them — and the
  signed-out namespace is exactly where the app wrote before accounts existed, so
  studying first and signing up later loses nothing.

The API is a small service in `apps/server` with no runtime dependencies:

```bash
npm run server   # http://localhost:4000, accounts in .data/accounts.json
```

It ships with a Dockerfile and a `render.yaml` blueprint, so hosting it on a free
tier is a repository-connect and one repository variable — `API_URL`, which the
Pages workflow passes to the web build. Free tiers sleep when idle and keep no
disk between deploys, and the app is built to behave sensibly under both: sign-in
retries once with a long timeout and says it is waking the server, and studying
never waits for the network at all.

Endpoints, the security decisions behind them, the hosting steps, and what sync
does and does not guarantee: [docs/API.md](docs/API.md).

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

## One room, four inks

An earlier version gave each language a complete visual identity: two dark themes, two
light, four corner radii, four sets of grade colours. It was defensible on paper and
heavy in the hand — switching from Japanese to Mandarin turned the lights off, and
anyone studying two languages had to re-learn the room every time they switched.

Now the palettes share everything structural: one warm near-white ground, one ink for
text, one grade scale, one corner radius. What varies is a single accent.

| Language | Ink | Drawn from |
| --- | --- | --- |
| Mandarin | Cinnabar | The red of a seal, stamped once on a page of black ink. |
| Japanese | Indigo | Aizome indigo, the working colour of everyday cloth. |
| Korean | Celadon | The green-blue glaze of Goryeo celadon. |
| Vietnamese | Gold leaf | Gold leaf laid over sơn mài lacquer. |

The themes live in `@language-srs/core` as data, not in the React layer — so the app,
the iOS widget and the Android widget all render the same palette without it being
defined three times. Switching language re-tints the app and its widget together.

The design language is **Paper & Ink**: surfaces are sheets, colour is pigment applied
only where it means something, and motion explains rather than entertains. The full
spec, including every motion pattern and the reasoning behind each, is in
[docs/DESIGN.md](docs/DESIGN.md).

Each language also gets a place and a drawing of it: a pagoda over Beijing rooftops, a
torii with the mountain behind, hanok eaves under Seoul's towers, a junk under the karsts
of Hạ Long. Line art rather than photographs, in that language's own ink, arriving in
three strokes — sky, buildings, then the sun or the moon or the seal. Nobody learns
Vietnamese because it is ISO 639-1 `vi`, and the interface should know that.

Tonal languages get a tone ramp: each syllable of a Mandarin or Vietnamese word is
coloured by its tone. Colour is part of the answer on a tone card, so the ramps are
stated explicitly per language and tested for distinctness and contrast — not derived
from the semantic palette, which collides.

## Layout

```
packages/core/            @language-srs/core — all the domain logic, no React or DOM
  exams/                  HSK, JLPT, TOPIK and Vietnamese curricula
  srs/                    FSRS-4.5 scheduler + exam-date pressure
  session/                queue building, daily caps, exam-weighted card mix
  stats/                  streaks, true retention, coverage, exam readiness
                          — and per-*word* progress, for the vocabulary views
  sessions/               study sittings: recording, reconstruction, summaries
  auth/                   the account contract, shared with the server
  teachers/               the four characters, their methods and their lines
  practice/               tone inventories and answer checking
  theme/                  the shared ground and the four inks
  widget/                 the widget payload contract and deep links
  data/                   seed decks and the bulk importer
  engine.ts               the single API the app talks to

apps/server/              @language-srs/server — the account API, no runtime deps
  crypto/                 scrypt password hashing, session tokens
  services/               accounts, device sessions, state sync, sittings
  store/                  the storage seam: in-memory and JSON-file

apps/mobile/              Expo app: iOS, Android and web from one codebase
  app/index.tsx           the landing page — languages, teachers, method
  app/home.tsx            the dashboard for the chosen language
  app/words.tsx           the vocabulary: one level's words, and the syllabus
  app/                    the rest of the expo-router screens
  src/auth/               the API client, the session, and the sync loop
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

npm test          # unit tests over the core domain and the API server
npm run typecheck # core + server + app

npm run web       # dev server in the browser
npm run web:build # static export to apps/mobile/dist

npm run server    # the account API on :4000 — optional, studying works without it
```

The app talks to whatever `EXPO_PUBLIC_API_URL` says at build time, defaulting to
`http://localhost:4000`. Signing in is the only thing that needs it.

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
