package com.languagesrs.app.widget

import android.content.Context
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import org.json.JSONArray
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

/**
 * The Kotlin mirror of `WidgetSnapshot` from `@language-srs/core`.
 *
 * Parsed with `org.json`, which ships with Android, rather than adding a
 * serialisation library — a home-screen widget is the last place to spend APK size
 * and cold-start time on a dependency for one flat object.
 *
 * Same two rules as the Swift model. Every field is already formatted for display,
 * and every field is defaulted: the widget process can be handed a payload written
 * by an older or newer app build, and a widget that throws while inflating just
 * renders nothing with no error surface anywhere.
 */
data class WidgetSnapshot(
  val schemaVersion: Int,
  val theme: WidgetTheme,
  val languageEmoji: String,
  val languageBadge: String,
  val examCaption: String,
  val levelShortName: String,
  val dueCount: Int,
  val freshCount: Int,
  val learningCount: Int,
  val totalCount: Int,
  val streakCaption: String,
  val readinessPercent: Int,
  val readinessHeadline: String,
  val nextCard: WidgetCard?,
  val spotlight: WidgetCard?,
  val actionLabel: String,
  val actionDeepLink: String,
  val emptyStateCaption: String,
)

/**
 * Both palettes, sent by the app.
 *
 * Light *and* dark, because a widget follows the system appearance independently of
 * the app that wrote its payload — the phone may have switched to dark mode without
 * the app being opened since. `resolve` picks using Glance's own theme, which is
 * still rendering rather than computing.
 */
data class WidgetTheme(
  val accentName: String,
  val light: WidgetPalette,
  val dark: WidgetPalette,
  val cornerRadius: Dp,
) {
  fun resolve(dark: Boolean): WidgetPalette = if (dark) this.dark else light

  companion object {
    /**
     * Used only alongside the "open to sync" placeholder, when there is no readable
     * payload. Neutral rather than any language's accent, because at that point the
     * widget does not know which language it belongs to.
     */
    val FALLBACK = WidgetTheme(
      accentName = "",
      light = WidgetPalette(
        canvas = Color(0xFFFCFCFB),
        surface = Color(0xFFF4F4F1),
        line = Color(0xFFE2E2DD),
        ink = Color(0xFF16161A),
        inkMuted = Color(0xFF6B6B70),
        accent = Color(0xFF16161A),
        onAccent = Color(0xFFFFFFFF),
        gradeColors = listOf(
          Color(0xFFB4342A),
          Color(0xFFA9762A),
          Color(0xFF2E7D6B),
          Color(0xFF3B5B94),
        ),
      ),
      dark = WidgetPalette(
        canvas = Color(0xFF0C0C0D),
        surface = Color(0xFF161618),
        line = Color(0xFF26262A),
        ink = Color(0xFFF4F4F2),
        inkMuted = Color(0xFF98989E),
        accent = Color(0xFFF4F4F2),
        onAccent = Color(0xFF0C0C0D),
        gradeColors = listOf(
          Color(0xFFE0665C),
          Color(0xFFD8A24A),
          Color(0xFF58AE99),
          Color(0xFF7A9BD4),
        ),
      ),
      cornerRadius = 14.dp,
    )
  }
}

/** One mode's colours, already resolved. */
data class WidgetPalette(
  val canvas: Color,
  val surface: Color,
  val line: Color,
  val ink: Color,
  val inkMuted: Color,
  val accent: Color,
  val onAccent: Color,
  /** Grade button colours, indexed by rating 1-4. */
  val gradeColors: List<Color>,
) {
  fun gradeColor(rating: Int): Color = gradeColors.getOrElse(rating - 1) { accent }
}

data class WidgetCard(
  val cardId: String,
  val kind: String,
  val prompt: String,
  val promptHint: String,
  val reading: String,
  val answer: String,
  val example: String?,
  val exampleTranslation: String?,
  val options: List<GradeOption>,
  val deepLink: String,
)

data class GradeOption(
  val rating: Int,
  val label: String,
  val interval: String,
  val deepLink: String,
)

/** Schema version this widget understands; matches `WIDGET_SCHEMA_VERSION` in core. */
const val SUPPORTED_SCHEMA_VERSION = 3

object SnapshotStore {
  private fun prefsName(context: Context): String = metadata(context, "com.languagesrs.WIDGET_PREFS", "language_srs_widget")

  private fun payloadKey(context: Context): String =
    metadata(context, "com.languagesrs.WIDGET_PAYLOAD_KEY", "widget_snapshot")

  private fun pendingKey(context: Context): String =
    metadata(context, "com.languagesrs.WIDGET_PENDING_KEY", "widget_pending_grades")

  private fun metadata(context: Context, key: String, fallback: String): String {
    val info = context.packageManager.getApplicationInfo(
      context.packageName,
      android.content.pm.PackageManager.GET_META_DATA,
    )
    return info.metaData?.getString(key) ?: fallback
  }

  /**
   * Reads the snapshot, or null on any problem.
   *
   * Never throws, for the same reason as the iOS side: opening the app rewrites
   * the payload, so a null here shows a self-healing "open to sync" placeholder
   * instead of a blank widget.
   */
  fun read(context: Context): WidgetSnapshot? {
    val prefs = context.getSharedPreferences(prefsName(context), Context.MODE_PRIVATE)
    val json = prefs.getString(payloadKey(context), null) ?: return null

    return try {
      val root = JSONObject(json)
      val version = root.optInt("schemaVersion", 0)
      if (version > SUPPORTED_SCHEMA_VERSION) return null

      val counts = root.optJSONObject("counts")
      val exam = root.optJSONObject("exam")
      val streak = root.optJSONObject("streak")
      val readiness = root.optJSONObject("readiness")
      val language = root.optJSONObject("language")
      val action = root.optJSONObject("action")

      WidgetSnapshot(
        schemaVersion = version,
        theme = parseTheme(root.optJSONObject("theme")),
        languageEmoji = language?.optString("emoji").orEmpty(),
        languageBadge = language?.optString("badge").orEmpty(),
        examCaption = exam?.optString("caption").orEmpty(),
        levelShortName = exam?.optString("levelShortName").orEmpty(),
        dueCount = counts?.optInt("due") ?: 0,
        freshCount = counts?.optInt("fresh") ?: 0,
        learningCount = counts?.optInt("learning") ?: 0,
        totalCount = counts?.optInt("total") ?: 0,
        streakCaption = streak?.optString("caption").orEmpty(),
        readinessPercent = readiness?.optInt("percent") ?: 0,
        readinessHeadline = readiness?.optString("headline").orEmpty(),
        nextCard = parseCard(root.optJSONObject("nextCard")),
        spotlight = parseCard(root.optJSONObject("spotlight")),
        actionLabel = action?.optString("label").orEmpty(),
        actionDeepLink = action?.optString("deepLink") ?: "languagesrs:///",
        emptyStateCaption = root.optString("emptyStateCaption"),
      )
    } catch (_: Throwable) {
      null
    }
  }

  private fun parseTheme(json: JSONObject?): WidgetTheme {
    if (json == null) return WidgetTheme.FALLBACK

    return WidgetTheme(
      accentName = json.optString("accentName"),
      light = parsePalette(json.optJSONObject("light"), WidgetTheme.FALLBACK.light),
      dark = parsePalette(json.optJSONObject("dark"), WidgetTheme.FALLBACK.dark),
      cornerRadius = json.optDouble("cornerRadius", 14.0).dp,
    )
  }

  private fun parsePalette(json: JSONObject?, fallback: WidgetPalette): WidgetPalette {
    if (json == null) return fallback

    val gradesArray = json.optJSONArray("gradeColors")
    val grades = if (gradesArray == null) {
      fallback.gradeColors
    } else {
      (0 until gradesArray.length()).map { index ->
        parseColor(gradesArray.optString(index), fallback.gradeColors.getOrElse(index) { fallback.accent })
      }
    }

    return WidgetPalette(
      canvas = parseColor(json.optString("canvas"), fallback.canvas),
      surface = parseColor(json.optString("surface"), fallback.surface),
      line = parseColor(json.optString("line"), fallback.line),
      ink = parseColor(json.optString("ink"), fallback.ink),
      inkMuted = parseColor(json.optString("inkMuted"), fallback.inkMuted),
      accent = parseColor(json.optString("accent"), fallback.accent),
      onAccent = parseColor(json.optString("onAccent"), fallback.onAccent),
      gradeColors = grades,
    )
  }

  /**
   * Parse a `#RRGGBB` string, falling back rather than throwing.
   *
   * One malformed colour should cost that one colour, not the whole widget.
   */
  private fun parseColor(hex: String?, fallback: Color): Color {
    val cleaned = hex?.removePrefix("#") ?: return fallback
    if (cleaned.length != 6) return fallback
    val value = cleaned.toLongOrNull(16) ?: return fallback
    return Color(value or 0xFF000000L)
  }

  private fun parseCard(json: JSONObject?): WidgetCard? {
    if (json == null) return null

    val optionsArray = json.optJSONArray("options") ?: JSONArray()
    val options = (0 until optionsArray.length()).mapNotNull { index ->
      val option = optionsArray.optJSONObject(index) ?: return@mapNotNull null
      GradeOption(
        rating = option.optInt("rating"),
        label = option.optString("label"),
        interval = option.optString("interval"),
        deepLink = option.optString("deepLink"),
      )
    }

    return WidgetCard(
      cardId = json.optString("cardId"),
      kind = json.optString("kind"),
      prompt = json.optString("prompt"),
      promptHint = json.optString("promptHint"),
      reading = json.optString("reading"),
      answer = json.optString("answer"),
      example = json.optString("example").ifEmpty { null },
      exampleTranslation = json.optString("exampleTranslation").ifEmpty { null },
      options = options,
      deepLink = json.optString("deepLink"),
    )
  }

  /**
   * Queues a grading for the app to replay through the real scheduler.
   *
   * Timestamps are written in the same ISO-8601-with-milliseconds form core
   * produces, because the replay orders gradings by this string and compares it
   * against `card.lastReviewedAt` to drop stale taps.
   */
  fun appendPendingGrade(context: Context, cardId: String, rating: Int) {
    val prefs = context.getSharedPreferences(prefsName(context), Context.MODE_PRIVATE)
    val key = pendingKey(context)

    val queue = try {
      JSONArray(prefs.getString(key, "[]") ?: "[]")
    } catch (_: Throwable) {
      JSONArray()
    }

    queue.put(
      JSONObject().apply {
        put("cardId", cardId)
        put("rating", rating)
        put("gradedAt", isoNow())
      },
    )

    prefs.edit().putString(key, queue.toString()).apply()
  }

  private fun isoNow(): String {
    val format = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US)
    format.timeZone = TimeZone.getTimeZone("UTC")
    return format.format(Date())
  }
}
