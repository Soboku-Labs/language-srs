# Mon · 門

Exam-aligned spaced repetition for **Mandarin, Japanese, Korean and Vietnamese**.

門 is the everyday word for a door in three of them — 门 *mén*, 門 *mon*, 문 *mun* —
and in Vietnamese **môn** is the live Sino-Vietnamese word for a subject of study:
*nhập môn* is "an introduction to a field", exactly as 入門 is in the other three.
One word, the same idea in all four, standard in each. The glyph is the icon.

One domain core behind one backend; the web app and the phone apps are interfaces
over it. Home-screen widgets on iOS and Android.

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

The palettes live in `@mon/core` as data, not in the React layer, so the app
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
proto/mon/v1/mon.proto    The contract: language-neutral, linted, versioned

packages/api/             The contract, generated, plus the client
  src/gen/                generated from the proto, committed
  src/enums.ts            enum tables, one per enum, inverted mechanically
  src/convert.ts          domain to wire, for the backend
  src/decode.ts           wire to domain, for a client with its own copy
  src/client.ts           bearer token, one renewal at a time, one retry
  src/sync.ts             push what this device did, take what the backend says

apps/server/              The backend: the core behind Connect
  src/app.ts              dispatch, CORS, per-account engines, two listeners
  src/connect/            the two services, over the same core
  src/accounts.ts         scrypt passwords, revocable tokens
  src/store.ts            the storage port on a filesystem, atomic writes
  src/routes/             the older JSON surface, served as the fallback

apps/web/                 The website: React + Vite, no React Native runtime
  src/screens/            one file per screen
  src/ui.tsx              the Suboku primitives as DOM
  src/styles.css          the whole stylesheet; colours are CSS variables
  src/router.tsx          a hand-written router, because the route set is fixed

packages/core/            @mon/core — all the domain logic, no React or DOM
  exams/                  HSK, JLPT, TOPIK and Vietnamese curricula
  srs/                    FSRS-4.5 scheduler + exam-date pressure
  session/                queue building, daily caps, exam-weighted card mix
  answer/                 multiple choice, typed answers, tone questions
  deck/                   the learner's words, for browsing and searching
  auth/                   accounts, and which slice of storage each one reads
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

### Icons

Generated, never checked in:

```bash
npm run icons
```

One source glyph produces the favicon pair, the PWA maskable icon, the Apple touch
icon, the web manifest, and the iOS, Android-adaptive and splash sources. It runs
as part of `web:build`, `web:pages` and `prebuild`, so the icons cannot drift from
the design — there is no bitmap to forget to re-export, and the iOS icon and the
favicon are the same SVG with different padding rules.

### One core, separate apps

The web app and the phone app are now separate programs over a shared domain core,
rather than one codebase rendered three ways.

The reason is weight. Shipping web, iOS and Android from one React Native codebase
put react-native-web, react-dom, expo-router and Reanimated into the browser —
about 80% of a 1.3MB payload — to render a website. Splitting the web out drops it
to 352KB (109KB gzipped) and cuts time-to-usable on a throttled mid-tier phone from
~4.0s to ~1.4s.

Nothing was duplicated to get there. `packages/core` is pure TypeScript, so the
scheduler, the exam curricula, the queue builder, the answer generation, the deck,
the triage and the journey are the *same code* in both apps — one implementation,
one test suite, no chance of the two drifting on something as unforgiving as a
review schedule. What differs is only what genuinely differs: the storage adapter,
the motion, the routing and the widgets.

### Native clients, one brain

The phones are going native — SwiftUI and Jetpack Compose — and the scheduler is
not being ported to get there. `apps/server` runs `packages/core` behind
[Connect](https://connectrpc.com), serving `proto/mon/v1/mon.proto`, so a native
client renders what it is given and owns no scheduling logic at all. Nobody
writes FSRS in Swift, nobody writes it again in Kotlin, and the two cannot drift.

Connect rather than raw gRPC because **a browser cannot speak gRPC** — HTTP/2
trailers are not exposed to JavaScript — and running an Envoy sidecar to
translate for one web app is a second process to deploy and monitor for nothing
the web app can feel. One server, four protocols: Connect with protobuf bodies
for the phones, Connect with JSON for the browser and for `curl`, gRPC-Web, and
real gRPC on a second listener for anything that insists.

The obvious objection to centralising it is offline, and it is a real one: a
spaced-repetition app that stops working on the Underground is a worse app. So
grading takes a *batch*, each entry carrying the instant it actually happened. A
client records reviews locally and replays them on reconnect, and the scheduler
sees the real timestamps rather than the moment the signal returned. The contract
is in [docs/API.md](docs/API.md), and the reasoning — including what building it
proved wrong — in
[docs/ARCHITECTURE-DECISIONS.md](docs/ARCHITECTURE-DECISIONS.md).

`apps/mobile` is the current Expo app and still builds iOS and Android. It stays
until the native clients replace it.

### Syncing, and why the web app still schedules locally

Signing in carries progress between devices. Gradings go up as a batch with their
real timestamps, and the backend's card state comes back down — because the
scheduler fuzzes due dates, so two devices replaying the same reviews would land
a day or two apart and one of them has to be the answer.

The web app keeps running `packages/core` itself rather than calling the API for
every screen, and that is deliberate. The thing worth preventing is a second
*implementation* of FSRS, not a second process running the same one: a hand-port
into Swift and another into Kotlin is three chances to disagree silently, while
the web app imports the identical source the backend does. Calling over the
network instead would buy the same answers at the cost of a loading state on every
screen and an app that stops working in a tunnel.

Retries are safe: each grading carries the review id the client minted, and the
backend reports one it has already applied as a duplicate rather than counting it
twice. Without that, a connection that drops *after* the server committed leaves
a client choosing between losing reviews and inflating the learner's streak.

## Running it

```bash
npm install

npm test          # the core domain, and the API over a real socket
npm run typecheck # core + server + web + mobile

npm run web        # Vite dev server
npm run web:build  # static build to apps/web/dist
npm run web:pages  # the same, prefixed and prepared for GitHub Pages

npm run server     # the API on :8787, data in ./data
npm run server:test

npm run proto:lint      # buf lint, STANDARD
npm run proto:generate  # regenerate apps/server/src/gen
npm run proto:breaking  # against main, before anything ships

npm run mobile:start  # Expo, for iOS and Android
npm run ios
npm run android
```

### Accounts

Studying never requires one. A learner who taps "Continue on this device" gets a
local profile and the whole app; the account exists so two people can share a
device and so a future sync has an identity to attach progress to.

Email sign-in talks to a backend over the client in `packages/core/src/auth/http.ts`
and appears only when one is configured:

```bash
EXPO_PUBLIC_AUTH_URL=https://your-api.example.com npm run web:build
```

With nothing set, the sign-in screen says so rather than showing a password field
with nothing behind it. **There is no backend yet** — the client is written, the
server is not, so email sign-in cannot currently succeed against anything.

Metro's cache is not keyed on environment variables, so pass `--clear` the first
time you change this or the old value stays compiled in.

Each account reads its own slice of storage (`PrefixedStore`). The device profile
deliberately keeps the unprefixed keys, so upgrading to this version does not look
like your progress was deleted.

### Web performance, and why not Vite

The web build is Metro, the same bundler the iOS and Android builds use. That is not
inertia: Vite cannot bundle for React Native's native targets, and expo-router is built
on Metro's `require.context` and Expo's Babel transformer, so moving the website to Vite
means either dropping the phones or running two bundlers against one codebase.

It would also not have helped. Measured by source map, the bundle was roughly 80%
framework — expo-router, Reanimated, react-native-web and react-dom — and about 12% our
own code. A different bundler does not make react-native-web smaller. The payload is the
cost of shipping one codebase to web, iOS and Android, so that is where the savings had
to come from:

- **Route-level code splitting** (`asyncRoutes: { web: 'production' }`). Each screen is
  its own chunk, fetched on first visit. Worth about 3% on its own, because the
  framework ends up in the chunk every route shares — but it grows as screens are added.
- **No Reanimated on the web.** `src/motion/components.web.tsx` and `tokens.web.ts`
  implement the same seven components on the Web Animations API, and Metro prefers
  `.web` for the web bundle. Reanimated earns its weight on a phone, where it runs
  animations off the JS thread; in a browser there is no bridge to avoid and it is a
  large polyfill for `Element.animate`. This is the big one.

First load went from 2,164KB to 1,258KB raw (505KB to 338KB gzipped), and time to a
usable screen on a throttled mid-tier phone from ~4.0s to ~3.0s. The phones are
untouched — they keep Reanimated and a single bundle, which is what you want where there
is no network between the app and its own code.

The remaining weight is react-native-web plus react-dom plus expo-router. Shrinking that
further means giving up the shared codebase, which is a product decision rather than a
build one.

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
is a starting point, not a syllabus.

Full word lists go in through **Settings → Vocabulary → Add or back up words**, which
takes a pasted CSV or JSON (and a file on the web). Every row is validated and reported
with its row number before anything is committed, so a list with a mistyped level id
says so rather than importing cleanly and producing cards that never appear in a queue.
The same screen exports the deck — including your own notes — as JSON to import back.
Column order and the shape of each field: [docs/DATA.md](docs/DATA.md).

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
