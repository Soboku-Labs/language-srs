import ExpoModulesCore
import WidgetKit

/**
 The iOS half of the app-to-widget bridge.

 The app and the widget extension are separate processes with separate sandboxes,
 so they share data through an App Group container. The group identifier is
 injected at build time by the config plugin (see `plugins/withWidgets.ts`) rather
 than hard-coded, so changing the bundle id in `app.config.ts` cannot leave the
 two halves pointing at different containers.

 Nothing here interprets the payload. It is an opaque JSON string produced by
 `@language-srs/core` and handed straight to the widget, which is what keeps the
 scheduling logic in one place instead of reimplemented in Swift.
 */
public class WidgetBridgeModule: Module {
  /// Injected by the config plugin into the app target's Info.plist.
  private var appGroup: String {
    Bundle.main.object(forInfoDictionaryKey: "LanguageSRSAppGroup") as? String
      ?? "group.com.languagesrs.app"
  }

  private var payloadKey: String {
    Bundle.main.object(forInfoDictionaryKey: "LanguageSRSWidgetPayloadKey") as? String
      ?? "widget_snapshot"
  }

  private var pendingKey: String {
    Bundle.main.object(forInfoDictionaryKey: "LanguageSRSWidgetPendingKey") as? String
      ?? "widget_pending_grades"
  }

  private var defaults: UserDefaults? {
    UserDefaults(suiteName: appGroup)
  }

  public func definition() -> ModuleDefinition {
    Name("WidgetBridge")

    Property("isSupported") { () -> Bool in
      // WidgetKit exists from iOS 14. Below that the app still works; it simply
      // has no home-screen presence.
      if #available(iOS 14.0, *) {
        return true
      }
      return false
    }

    AsyncFunction("writeSnapshot") { (json: String) in
      guard let defaults = self.defaults else {
        throw AppGroupUnavailableException(self.appGroup)
      }
      defaults.set(json, forKey: self.payloadKey)
    }

    AsyncFunction("readPendingGrades") { () -> String? in
      self.defaults?.string(forKey: self.pendingKey)
    }

    AsyncFunction("clearPendingGrades") {
      // Removing rather than writing "[]" so a widget appending concurrently
      // starts from a clean array instead of parsing a placeholder.
      self.defaults?.removeObject(forKey: self.pendingKey)
    }

    AsyncFunction("reloadWidgets") {
      if #available(iOS 14.0, *) {
        WidgetCenter.shared.reloadAllTimelines()
      }
    }
  }
}

/**
 Raised when the App Group container cannot be opened.

 Almost always a provisioning problem: the group is missing from the app's
 entitlements, or the identifier does not match the one in the Apple Developer
 portal. Failing loudly here is deliberate — the alternative is a widget that
 silently shows the empty state forever.
 */
internal final class AppGroupUnavailableException: GenericException<String> {
  override var reason: String {
    "Could not open App Group container '\(param)'. Check that the group is listed in the app's entitlements and registered for the bundle identifier."
  }
}
