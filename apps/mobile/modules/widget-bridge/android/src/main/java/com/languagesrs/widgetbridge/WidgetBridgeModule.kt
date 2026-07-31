package com.languagesrs.widgetbridge

import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * The Android half of the app-to-widget bridge.
 *
 * Android is simpler than iOS here — the app widget runs in the app's own process
 * and can read the app's SharedPreferences directly, so there is no App Group
 * equivalent to provision. The file name and keys still come from the manifest
 * metadata written by the config plugin, so the app and the widget cannot drift
 * apart when the bundle id changes.
 *
 * Refreshing is a broadcast rather than a direct call: `AppWidgetManager` owns the
 * widget instances, and an APPWIDGET_UPDATE broadcast is what makes every one of
 * them re-run its provider. Sending it to the provider component by name means
 * only this app's widgets are woken.
 */
class WidgetBridgeModule : Module() {
  private val context: Context
    get() = requireNotNull(appContext.reactContext) { "React context is unavailable" }

  private fun metadata(key: String, fallback: String): String {
    val info = context.packageManager.getApplicationInfo(
      context.packageName,
      android.content.pm.PackageManager.GET_META_DATA,
    )
    return info.metaData?.getString(key) ?: fallback
  }

  private val prefsName: String
    get() = metadata("com.languagesrs.WIDGET_PREFS", "language_srs_widget")

  private val payloadKey: String
    get() = metadata("com.languagesrs.WIDGET_PAYLOAD_KEY", "widget_snapshot")

  private val pendingKey: String
    get() = metadata("com.languagesrs.WIDGET_PENDING_KEY", "widget_pending_grades")

  private fun prefs() = context.getSharedPreferences(prefsName, Context.MODE_PRIVATE)

  override fun definition() = ModuleDefinition {
    Name("WidgetBridge")

    Property("isSupported") { true }

    AsyncFunction("writeSnapshot") { json: String ->
      prefs().edit().putString(payloadKey, json).apply()
    }

    AsyncFunction("readPendingGrades") {
      prefs().getString(pendingKey, null)
    }

    AsyncFunction("clearPendingGrades") {
      prefs().edit().remove(pendingKey).apply()
    }

    AsyncFunction("reloadWidgets") {
      val manager = AppWidgetManager.getInstance(context)

      for (providerClass in WIDGET_PROVIDERS) {
        val component = ComponentName(context.packageName, providerClass)
        val ids = runCatching { manager.getAppWidgetIds(component) }.getOrNull() ?: continue
        if (ids.isEmpty()) continue

        context.sendBroadcast(
          Intent(AppWidgetManager.ACTION_APPWIDGET_UPDATE).apply {
            component.let { setComponent(it) }
            putExtra(AppWidgetManager.EXTRA_APPWIDGET_IDS, ids)
          },
        )
      }
    }
  }

  private companion object {
    /**
     * Provider class names, by string rather than class reference.
     *
     * The providers live in the app module, which this library module cannot
     * depend on without a circular dependency. Missing providers are skipped, so
     * a build that ships only one widget size still works.
     */
    val WIDGET_PROVIDERS = listOf(
      "com.languagesrs.app.widget.ReviewWidgetProvider",
      "com.languagesrs.app.widget.SpotlightWidgetProvider",
    )
  }
}
