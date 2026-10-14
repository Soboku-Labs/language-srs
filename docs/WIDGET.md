# Home-screen widgets

## The idea

A widget that is worth keeping on a home screen has to do two things: tell you whether
there is anything to do, and let you do some of it without opening the app.

- **Small / accessory** — the count and the streak. "Is there anything to do?"
- **Medium** — a card front with four grade buttons. Tap one and it is recorded; the app
  does not open.
- **Large** — the same, plus an example sentence and exam readiness.

When nothing is due the widget does not go blank. It shows a **spotlight** word — the
least recently reviewed card you have already met — because passive exposure between
sessions is the cheapest study there is, and a widget that is empty six days out of seven
gets removed.

The widget wears the Suboku system: the neutral canvas, with the active language's
single accent. Both palettes travel in the payload and the widget picks with its own
appearance, so it follows the home screen rather than whichever mode the app was last
in — and holds no palette of its own, so it cannot drift from the app.

## The governing rule

**The widget renders. It does not compute.**

Not tidiness. A WidgetKit timeline provider has a small time budget and no access to the
app's process, and Glance re-renders in a remote process under the same constraints.
Anything the native side works out is logic that exists three times — TypeScript, Swift,
Kotlin — and drifts in two of them.

So the payload is flat and every value in it is already final:

- Intervals on the grade buttons ("10m", "4d", "1.2y") come from `previewIntervals`.
- Captions are already written and pluralised: "HSK 4 in 23 days", "12 day streak".
- Both palettes arrive as hex strings; the widget picks a mode, nothing more.
- Which card is next has already been decided by the queue builder.

Swift and Kotlin contain no date maths, no interval formatting, no palettes, and no
scheduler.

## Data flow

```
app                                     shared container            widget
───                                     ────────────────            ──────
StudyEngine.getWidgetSnapshot()
  → JSON  ────────────────────────────▶ widget_snapshot  ─────────▶ render
                                                                      │
                                                          grade tap ──┘
                                        widget_pending_grades ◀── {cardId, rating, gradedAt}
  ◀──────────────────────────────────── read on launch/foreground
applyPendingGrades() through real FSRS
  → republish snapshot ───────────────▶ widget_snapshot
```

The container is an **App Group** on iOS (`group.com.subokulabs.mon`) and
**SharedPreferences** on Android. Identifiers are declared once in `app.config.ts` and
threaded into Info.plist and the Android manifest by the config plugin, so changing the
bundle id cannot leave the two halves pointing at different containers.

### Why gradings are replayed rather than applied

The widget cannot run FSRS. It could, but that would mean a second implementation in
Swift and a third in Kotlin, and three schedulers disagree. Instead a tap records an
intent, and the app replays it through the real scheduler on next launch or foreground.

The cost is that the interval on the button is a prediction the app confirms later. Since
the widget got that prediction from the same payload, it agrees unless the card was also
graded elsewhere in between — and `applyPendingGrades` handles that case explicitly:

- **Stale** — the card was already reviewed at or after the widget's timestamp. Dropped;
  the newer review wins rather than rewinding memory state.
- **Duplicate** — same card, same timestamp, from a double-tapped button. Collapsed.
- **Card not found** — removed by a level change. Reported, not thrown.

## Platform notes

### iOS

Interactive grading uses an **App Intent** (`GradeCardIntent`), so on iOS 17+ the button
runs in the widget's own process and the app never opens. Below 17 the button is a `Link`
to `languagesrs:///grade?card=…&rating=…`, and the app grades and continues the session.

WidgetKit cannot poll, so `buildWidgetTimeline` produces snapshots at future instants —
a widget showing "4 due" needs to already know it will say "9 due" at 6pm. That is only
possible because the scheduler is pure and takes `now` as an argument.

### Android

The app widget runs in the app's own process and reads SharedPreferences directly, so
there is no App Group to provision. Grading goes through a Glance `ActionCallback`.

`updatePeriodMillis` is a floor Android enforces loosely and never more often than every
30 minutes; the app's `reloadWidgets` broadcast is what makes updates feel immediate
after a review.

### Web

There are no home-screen widgets. `WidgetBridgeModule.web.ts` is a no-op with
`isSupported: false`, picked up by Metro's platform extensions, so the web bundle never
reaches `requireNativeModule` and no caller has to test the platform.

## Schema versioning

`WIDGET_SCHEMA_VERSION` (currently **3**; v2 added the theme block, v3 replaced it
with both palettes at once) is stamped into every
payload and checked by both decoders. A widget binary outlives the app process that wrote
its payload — the user may not have updated, or may have updated and not yet opened the
app — so a payload from the future renders "Open to sync" rather than half-understood
fields. There is no error UI for a widget that throws; it just goes blank.

Every field except the version is optional or defaulted in the Swift and Kotlin models
for the same reason.

## Building and verifying

```bash
npm run prebuild   # generates ios/ and android/ with the widget targets wired
npm run ios        # or npm run android
```

`plugins/withWidgets.ts` does the wiring on each prebuild:

**iOS** — declares the App Group on the app target, writes the group and key names into
Info.plist, copies `targets/ios-widget/*.swift` into `ios/LanguageSRSWidget/` with its own
Info.plist and entitlements, and creates the extension target in the Xcode project
including the **Embed App Extensions** copy phase. Missing that phase is the classic
failure: the widget builds cleanly and never appears in the gallery.

**Android** — copies `targets/android-widget/*.kt` into the app module, writes the
`appwidget-provider` XML for both sizes, registers the two receivers plus the
shared-preferences metadata in the manifest, and adds the Glance dependency.

### What has and has not been verified here

Verified in this environment:

- Core domain: unit tests over the scheduler, queue, stats, importer, themes and the
  widget payload, including JSON round-tripping of the snapshot.
- The web build: `expo export --platform web` succeeds and all four themes were driven
  in a real browser.

**Not verified here** — this environment has no Xcode and no Android SDK, so neither
native project has been compiled. The Swift and Kotlin sources and the config plugin are
complete, but treat the first `expo prebuild && npm run ios` as the real test. In
particular, if the Xcode extension target comes out missing or misconfigured, add it
through **File ▸ New ▸ Target ▸ Widget Extension** and point it at the copied sources —
the shared-container contract and the payload are unchanged either way.

To check the wiring end to end once running: add the widget, study a card in the app, and
confirm the count changes; then grade from the widget with the app force-quit, reopen it,
and confirm the review appears in the history with `source: "widget"`.
