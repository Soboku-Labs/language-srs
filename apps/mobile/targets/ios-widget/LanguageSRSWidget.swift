import AppIntents
import SwiftUI
import WidgetKit

/**
 The iOS home-screen widgets.

 Three families, because they answer three different questions:

 - `accessory` / small — "is there anything to do?" A count and a streak.
 - medium — "let me do one now." A card front with four grade buttons that work
   without opening the app, on iOS 17 and later.
 - large — the same, plus an example sentence and exam readiness.

 When nothing is due the widget does not go blank: it shows a spotlight word the
 learner has met before and is drifting away from. Passive exposure on the home
 screen between sessions is the cheapest study there is, and a widget that is
 empty six days out of seven gets removed.

 Every colour comes from `snapshot.theme`, which the app fills in from the active
 language's palette. This file holds no palette of its own — a Mandarin widget
 renders as ink and cinnabar and a Japanese one as washi and indigo, and neither
 can drift from the app it belongs to.
 */

// MARK: - Configuration injected by the config plugin

private enum WidgetConfig {
  static var appGroup: String {
    Bundle.main.object(forInfoDictionaryKey: "LanguageSRSAppGroup") as? String
      ?? "group.com.languagesrs.app"
  }

  static var payloadKey: String {
    Bundle.main.object(forInfoDictionaryKey: "LanguageSRSWidgetPayloadKey") as? String
      ?? "widget_snapshot"
  }

  static var pendingKey: String {
    Bundle.main.object(forInfoDictionaryKey: "LanguageSRSWidgetPendingKey") as? String
      ?? "widget_pending_grades"
  }
}

// MARK: - Timeline

struct ReviewEntry: TimelineEntry {
  let date: Date
  let snapshot: WidgetSnapshot?
}

/**
 Supplies the timeline WidgetKit renders from.

 iOS does not let a widget poll, so the app pre-computes snapshots at future
 instants (see `buildWidgetTimeline` in core) and this provider hands them over.
 Here the provider reads the current snapshot and schedules one refresh; the app
 requests an immediate reload whenever it writes a new payload, so this hourly
 cadence is only the floor.
 */
struct ReviewTimelineProvider: TimelineProvider {
  func placeholder(in context: Context) -> ReviewEntry {
    ReviewEntry(date: Date(), snapshot: nil)
  }

  func getSnapshot(in context: Context, completion: @escaping (ReviewEntry) -> Void) {
    completion(currentEntry())
  }

  func getTimeline(in context: Context, completion: @escaping (Timeline<ReviewEntry>) -> Void) {
    let next = Calendar.current.date(byAdding: .hour, value: 1, to: Date())
      ?? Date().addingTimeInterval(3600)
    completion(Timeline(entries: [currentEntry()], policy: .after(next)))
  }

  private func currentEntry() -> ReviewEntry {
    ReviewEntry(
      date: Date(),
      snapshot: SnapshotStore.read(appGroup: WidgetConfig.appGroup, payloadKey: WidgetConfig.payloadKey)
    )
  }
}

// MARK: - Interactive grading

/**
 Grades a card straight from the home screen.

 On iOS 17 and later a widget button can run an App Intent in the widget's own
 process, so the learner grades without the app opening at all. The intent records
 the tap in the shared container and reloads the timeline; the app replays it
 through the real scheduler next time it runs.

 It deliberately does not compute the next interval. That would mean a second FSRS
 implementation in Swift, and two implementations of a scheduler disagree — the
 interval on the button already came from `previewIntervals` in the payload, so
 the learner sees a correct number without Swift computing anything.
 */
@available(iOS 17.0, *)
struct GradeCardIntent: AppIntent {
  static var title: LocalizedStringResource = "Grade card"
  static var description = IntentDescription("Record a review from the home screen.")

  @Parameter(title: "Card") var cardId: String
  @Parameter(title: "Rating") var rating: Int

  init() {}

  init(cardId: String, rating: Int) {
    self.cardId = cardId
    self.rating = rating
  }

  func perform() async throws -> some IntentResult {
    SnapshotStore.appendPendingGrade(
      appGroup: WidgetConfig.appGroup,
      pendingKey: WidgetConfig.pendingKey,
      cardId: cardId,
      rating: rating
    )
    WidgetCenter.shared.reloadAllTimelines()
    return .result()
  }
}

// MARK: - Views

struct LanguageSRSWidgetView: View {
  @Environment(\.widgetFamily) private var family
  let entry: ReviewEntry

  var body: some View {
    if let snapshot = entry.snapshot {
      content(for: snapshot)
    } else {
      NeedsRefreshView()
    }
  }

  @ViewBuilder
  private func content(for snapshot: WidgetSnapshot) -> some View {
    switch family {
    case .accessoryInline, .accessoryRectangular, .accessoryCircular:
      // Accessory families are tinted by the system, so they carry text only.
      AccessoryView(snapshot: snapshot)
    case .systemSmall:
      SmallView(snapshot: snapshot)
    case .systemLarge, .systemExtraLarge:
      LargeView(snapshot: snapshot)
    default:
      MediumView(snapshot: snapshot)
    }
  }
}

/**
 Shown when there is no readable payload.

 Uses system colours rather than theme colours, because the theme arrives with the
 payload and there isn't one. Opening the app republishes, so this state is
 self-healing.
 */
private struct NeedsRefreshView: View {
  var body: some View {
    VStack(spacing: 4) {
      Text("Language SRS").font(.caption).foregroundStyle(.secondary)
      Text("Open to sync").font(.headline)
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity)
  }
}

private struct SmallView: View {
  let snapshot: WidgetSnapshot

  var body: some View {
    let theme = snapshot.theme

    VStack(alignment: .leading, spacing: 6) {
      HStack {
        Text(snapshot.language.emoji)
        Text(snapshot.exam.levelShortName)
          .font(.caption).bold()
          .foregroundStyle(theme.mutedColor)
        Spacer()
      }

      if snapshot.counts.total > 0 {
        Text("\(snapshot.counts.total)")
          .font(.system(size: 42, weight: .bold, design: .rounded))
          .foregroundStyle(theme.textColor)
        Text("cards due").font(.caption).foregroundStyle(theme.mutedColor)
      } else if let spotlight = snapshot.spotlight {
        // Nothing due: show a word instead of a zero.
        Text(spotlight.prompt)
          .font(.system(size: 28, weight: .semibold))
          .foregroundStyle(theme.textColor)
          .minimumScaleFactor(0.5)
          .lineLimit(2)
        Text(spotlight.answer)
          .font(.caption2)
          .foregroundStyle(theme.mutedColor)
          .lineLimit(1)
      } else {
        Text("All clear").font(.headline).foregroundStyle(theme.accentColor)
      }

      Spacer(minLength: 0)
      Text(snapshot.streak.caption).font(.caption2).foregroundStyle(theme.mutedColor)
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    .widgetURL(URL(string: snapshot.action.deepLink))
  }
}

private struct MediumView: View {
  let snapshot: WidgetSnapshot

  var body: some View {
    let theme = snapshot.theme

    VStack(alignment: .leading, spacing: 8) {
      HStack {
        Text("\(snapshot.language.emoji) \(snapshot.exam.caption)")
          .font(.caption).foregroundStyle(theme.mutedColor)
        Spacer()
        if snapshot.counts.total > 0 {
          Text("\(snapshot.counts.total) due")
            .font(.caption).bold()
            .foregroundStyle(theme.accentColor)
        }
      }

      if let card = snapshot.nextCard {
        CardFace(card: card, theme: theme)
        GradeRow(card: card, theme: theme)
      } else if let spotlight = snapshot.spotlight {
        CardFace(card: spotlight, theme: theme)
        Text(snapshot.emptyStateCaption).font(.caption2).foregroundStyle(theme.mutedColor)
      } else {
        Text(snapshot.readiness.headline).font(.footnote).foregroundStyle(theme.textColor)
      }
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
  }
}

private struct LargeView: View {
  let snapshot: WidgetSnapshot

  var body: some View {
    let theme = snapshot.theme

    VStack(alignment: .leading, spacing: 10) {
      HStack {
        Text("\(snapshot.language.emoji) \(snapshot.exam.caption)")
          .font(.caption).foregroundStyle(theme.mutedColor)
        Spacer()
        Text("\(snapshot.readiness.percent)% ready")
          .font(.caption).bold()
          .foregroundStyle(theme.accentColor)
      }

      if let card = snapshot.nextCard ?? snapshot.spotlight {
        CardFace(card: card, theme: theme)

        if let example = card.example {
          VStack(alignment: .leading, spacing: 2) {
            Text(example).font(.footnote).foregroundStyle(theme.textColor)
            if let translation = card.exampleTranslation {
              Text(translation).font(.caption2).foregroundStyle(theme.mutedColor)
            }
          }
          .padding(8)
          .frame(maxWidth: .infinity, alignment: .leading)
          .background(
            theme.surfaceColor,
            in: RoundedRectangle(cornerRadius: theme.cornerRadius)
          )
        }

        if snapshot.nextCard != nil {
          GradeRow(card: card, theme: theme)
        }
      }

      Spacer(minLength: 0)

      HStack(spacing: 12) {
        Label("\(snapshot.counts.due) due", systemImage: "arrow.clockwise")
        Label("\(snapshot.counts.fresh) new", systemImage: "sparkles")
        Label(snapshot.streak.caption, systemImage: "flame")
      }
      .font(.caption2)
      .foregroundStyle(theme.mutedColor)
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
  }
}

private struct AccessoryView: View {
  let snapshot: WidgetSnapshot

  var body: some View {
    if snapshot.counts.total > 0 {
      Text("\(snapshot.counts.total) due · \(snapshot.exam.levelShortName)")
    } else if let spotlight = snapshot.spotlight {
      Text("\(spotlight.prompt) — \(spotlight.answer)").lineLimit(2)
    } else {
      Text(snapshot.exam.caption)
    }
  }
}

private struct CardFace: View {
  let card: WidgetCard
  let theme: WidgetSnapshot.Theme

  var body: some View {
    VStack(alignment: .leading, spacing: 2) {
      // The kind accent is resolved by the app, so the widget does not need the
      // kind-to-colour mapping.
      Text(card.promptHint).font(.caption2).foregroundStyle(theme.kindAccentColor)
      Text(card.prompt)
        .font(.system(size: 30, weight: .semibold))
        .foregroundStyle(theme.textColor)
        .minimumScaleFactor(0.4)
        .lineLimit(2)
    }
    .frame(maxWidth: .infinity, alignment: .leading)
  }
}

private struct GradeRow: View {
  let card: WidgetCard
  let theme: WidgetSnapshot.Theme

  var body: some View {
    HStack(spacing: 6) {
      ForEach(card.options) { option in
        if #available(iOS 17.0, *) {
          // Interactive: grades in the widget process, app stays closed.
          Button(intent: GradeCardIntent(cardId: card.cardId, rating: option.rating)) {
            GradeLabel(option: option, theme: theme)
          }
          .buttonStyle(.plain)
        } else {
          // Pre-iOS 17: hand off to the app, which grades and continues the session.
          Link(destination: URL(string: option.deepLink) ?? URL(string: "languagesrs:///")!) {
            GradeLabel(option: option, theme: theme)
          }
        }
      }
    }
  }
}

private struct GradeLabel: View {
  let option: WidgetCard.GradeOption
  let theme: WidgetSnapshot.Theme

  var body: some View {
    let tint = theme.gradeColor(option.rating)

    VStack(spacing: 0) {
      Text(option.label).font(.caption2).bold()
      Text(option.interval).font(.system(size: 9)).foregroundStyle(theme.mutedColor)
    }
    .frame(maxWidth: .infinity)
    .padding(.vertical, 6)
    .foregroundStyle(tint)
    .background(theme.surfaceColor, in: RoundedRectangle(cornerRadius: theme.cornerRadius))
    .overlay(
      RoundedRectangle(cornerRadius: theme.cornerRadius)
        .stroke(tint.opacity(0.5), lineWidth: 1)
    )
  }
}

// MARK: - Widget declarations

struct LanguageSRSWidget: Widget {
  let kind = "LanguageSRSWidget"

  var body: some WidgetConfiguration {
    StaticConfiguration(kind: kind, provider: ReviewTimelineProvider()) { entry in
      // The container background is themed too, so a light Japanese widget and a
      // dark Mandarin one sit correctly on the same home screen.
      let background = entry.snapshot?.theme.backgroundColor ?? Color.black

      if #available(iOS 17.0, *) {
        LanguageSRSWidgetView(entry: entry).containerBackground(background, for: .widget)
      } else {
        LanguageSRSWidgetView(entry: entry).padding().background(background)
      }
    }
    .configurationDisplayName("Review")
    .description("Your next card, with grade buttons that work without opening the app.")
    .supportedFamilies(supportedFamilies)
  }

  private var supportedFamilies: [WidgetFamily] {
    var families: [WidgetFamily] = [.systemSmall, .systemMedium, .systemLarge]
    if #available(iOS 16.0, *) {
      families.append(contentsOf: [.accessoryInline, .accessoryRectangular])
    }
    return families
  }
}

@main
struct LanguageSRSWidgetBundle: WidgetBundle {
  var body: some Widget {
    LanguageSRSWidget()
  }
}
