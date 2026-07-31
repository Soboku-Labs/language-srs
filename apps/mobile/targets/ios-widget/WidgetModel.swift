import Foundation

/**
 The Swift mirror of the `WidgetSnapshot` type in `@language-srs/core`.

 Two rules govern this file, and both come from the same principle: the widget
 renders, it does not compute.

 1. Every field is a value already formatted for display. There is no date maths,
    no interval formatting and no pluralisation here, because all of it happens in
    TypeScript where it is unit-tested once and used by all three platforms.
 2. Everything except `schemaVersion` is optional or defaulted. A widget binary
    outlives the app process that wrote its payload — the learner may not have
    updated the app, or may have updated it and not yet opened it — so a decode
    that trips over one unexpected field must degrade rather than crash. There is
    no error UI for a widget that throws; it just goes blank.
 */
struct WidgetSnapshot: Decodable {
  let schemaVersion: Int
  let generatedAt: String
  let language: Language
  let theme: Theme
  let exam: Exam
  let counts: Counts
  let streak: Streak
  let readiness: Readiness
  let nextCard: WidgetCard?
  let spotlight: WidgetCard?
  let action: Action
  let emptyStateCaption: String

  struct Language: Decodable {
    let code: String
    let name: String
    let badge: String
    let emoji: String
  }

  /**
   The active language's palette, sent by the app.

   Each of the four languages has its own theme — ink and cinnabar for Mandarin,
   washi and indigo for Japanese, and so on — and two of them are light while two
   are dark. Defining them here as well as in TypeScript would mean the Vietnamese
   widget drifting away from the Vietnamese app the first time anyone adjusted a
   colour, so the widget holds no palette of its own and renders what it is given.
   */
  struct Theme: Decodable {
    let name: String
    let mode: String
    let background: String
    let surface: String
    let border: String
    let text: String
    let textMuted: String
    let accent: String
    let secondary: String
    /// Grade button colours, indexed by rating 1-4.
    let gradeColors: [String]
    /// Accent for the card kind currently on screen.
    let kindAccent: String
    let cornerRadius: Double
  }

  struct Exam: Decodable {
    let trackName: String
    let levelName: String
    let levelShortName: String
    let examDate: String?
    let daysToExam: Int?
    let caption: String
  }

  struct Counts: Decodable {
    let due: Int
    let fresh: Int
    let learning: Int
    let total: Int
  }

  struct Streak: Decodable {
    let days: Int
    let studiedToday: Bool
    let caption: String
  }

  struct Readiness: Decodable {
    let percent: Int
    let verdict: String
    let headline: String
  }

  struct Action: Decodable {
    let label: String
    let deepLink: String
  }
}

struct WidgetCard: Decodable, Identifiable {
  let cardId: String
  let entryId: String
  let kind: String
  let prompt: String
  let promptHint: String
  let reading: String
  let answer: String
  let example: String?
  let exampleTranslation: String?
  let tones: [Int]?
  let options: [GradeOption]
  let deepLink: String
  let revealLink: String

  var id: String { cardId }

  struct GradeOption: Decodable, Identifiable {
    let rating: Int
    let label: String
    let interval: String
    let deepLink: String

    var id: Int { rating }
  }
}

/// Schema version this widget binary understands. Kept in step with
/// `WIDGET_SCHEMA_VERSION` in core; a newer payload falls back to a refresh prompt.
let supportedSchemaVersion = 2

/**
 Reads the snapshot out of the App Group container.

 Deliberately never throws. Every failure path — no container, no payload, invalid
 JSON, a schema version from the future — resolves to `nil`, and the views render
 a "tap to refresh" placeholder. Opening the app republishes the payload, which
 makes that placeholder self-healing.
 */
struct SnapshotStore {
  static func read(appGroup: String, payloadKey: String) -> WidgetSnapshot? {
    guard
      let defaults = UserDefaults(suiteName: appGroup),
      let json = defaults.string(forKey: payloadKey),
      let data = json.data(using: .utf8)
    else {
      return nil
    }

    guard let snapshot = try? JSONDecoder().decode(WidgetSnapshot.self, from: data) else {
      return nil
    }

    // A payload written by a newer app than this widget binary. Better to show
    // the placeholder than to render half-understood fields.
    guard snapshot.schemaVersion <= supportedSchemaVersion else { return nil }

    return snapshot
  }

  /**
   Appends a grading for the app to apply later.

   The widget cannot run FSRS — that lives in TypeScript — so a home-screen tap is
   recorded as an intent and replayed through the real scheduler on next launch.
   See `applyPendingGrades` in core for the replay and its conflict rules.

   Read-modify-write on a shared container is a race in principle. In practice
   only one widget process handles a tap at a time, and core's replay collapses
   exact duplicates, so a lost or doubled append degrades to "the tap did not
   register" rather than to corrupted scheduling state.
   */
  static func appendPendingGrade(
    appGroup: String,
    pendingKey: String,
    cardId: String,
    rating: Int
  ) {
    guard let defaults = UserDefaults(suiteName: appGroup) else { return }

    var queue: [[String: Any]] = []
    if let existing = defaults.string(forKey: pendingKey),
       let data = existing.data(using: .utf8),
       let decoded = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]] {
      queue = decoded
    }

    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]

    queue.append([
      "cardId": cardId,
      "rating": rating,
      "gradedAt": formatter.string(from: Date()),
    ])

    if let data = try? JSONSerialization.data(withJSONObject: queue),
       let json = String(data: data, encoding: .utf8) {
      defaults.set(json, forKey: pendingKey)
    }
  }
}

import SwiftUI

extension Color {
  /**
   Build a colour from a `#RRGGBB` string in the payload.

   Falls back to clear rather than trapping on a malformed value: a widget that
   crashes on one bad hex string shows nothing at all, while one that drops a
   single colour still renders.
   */
  init(hex: String) {
    let cleaned = hex.hasPrefix("#") ? String(hex.dropFirst()) : hex
    guard cleaned.count == 6, let value = UInt32(cleaned, radix: 16) else {
      self = .clear
      return
    }

    self.init(
      .sRGB,
      red: Double((value >> 16) & 0xFF) / 255,
      green: Double((value >> 8) & 0xFF) / 255,
      blue: Double(value & 0xFF) / 255,
      opacity: 1
    )
  }
}

extension WidgetSnapshot.Theme {
  var backgroundColor: Color { Color(hex: background) }
  var surfaceColor: Color { Color(hex: surface) }
  var borderColor: Color { Color(hex: border) }
  var textColor: Color { Color(hex: text) }
  var mutedColor: Color { Color(hex: textMuted) }
  var accentColor: Color { Color(hex: accent) }
  var secondaryColor: Color { Color(hex: secondary) }
  var kindAccentColor: Color { Color(hex: kindAccent) }

  /// Rating is 1-4; anything else falls back to the accent.
  func gradeColor(_ rating: Int) -> Color {
    guard rating >= 1, rating <= gradeColors.count else { return accentColor }
    return Color(hex: gradeColors[rating - 1])
  }
}
