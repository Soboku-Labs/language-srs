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
 * The active language's palette, sent by the app.
 *
 * Colours arrive as `#RRGGBB` strings and are parsed into `Color` on demand. The
 * widget holds no palette of its own for the same reason the iOS one does not:
 * four themes defined in three languages would be four themes that disagree.
 */
data class WidgetTheme(
  val name: String,
  val mode: String,
  val background: Color,
  val surface: Color,
  val border: Color,
  val text: Color,
  val textMuted: Color,
  val accent: Color,
  val secondary: Color,
  /** Grade button colours, indexed by rating 1-4. */
  val gradeColors: List<Color>,
  /** Accent for the card kind currently on screen. */
  val kindAccent: Color,
  val cornerRadius: Dp,
) {
  fun gradeColor(rating: Int): Color = gradeColors.getOrElse(rating - 1) { accent }

  companion object {
    /**
     * Used only when there is no readable payload, alongside the "open to sync"
     * placeholder. Neutral rather than any one language's palette, because at that
     * point the widget does not know which language it belongs to.
     */
    val FALLBACK = WidgetTheme(
      name = "",
      mode = "dark",
      background = Color(0xFF101418),
      surface = Color(0xFF1B2027),
      border = Color(0xFF2B323B),
      text = Color(0xFFF1F5F9),
      textMuted = Color(0xFF94A3B8),
      accent = Color(0xFF5B8DEF),
      secondary = Color(0xFF94A3B8),
      gradeColors = listOf(
        Color(0xFFEF6461),
        Color(0xFFE8A33D),
        Color(0xFF4CAF7D),
        Color(0xFF5B8DEF),
      ),
      kindAccent = Color(0xFF5B8DEF),
      cornerRadius = 12.dp,
    )
  }
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
const val SUPPORTED_SCHEMA_VERSION = 2

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

    val fallback = WidgetTheme.FALLBACK
    val gradesArray = json.optJSONArray("gradeColors")
    val grades = if (gradesArray == null) {
      fallback.gradeColors
    } else {
      (0 until gradesArray.length()).map { index ->
        parseColor(gradesArray.optString(index), fallback.gradeColors.getOrElse(index) { fallback.accent })
      }
    }

    return WidgetTheme(
      name = json.optString("name"),
      mode = json.optString("mode", "dark"),
      background = parseColor(json.optString("background"), fallback.background),
      surface = parseColor(json.optString("surface"), fallback.surface),
      border = parseColor(json.optString("border"), fallback.border),
      text = parseColor(json.optString("text"), fallback.text),
      textMuted = parseColor(json.optString("textMuted"), fallback.textMuted),
      accent = parseColor(json.optString("accent"), fallback.accent),
      secondary = parseColor(json.optString("secondary"), fallback.secondary),
      gradeColors = grades,
      kindAccent = parseColor(json.optString("kindAccent"), fallback.kindAccent),
      // Compose supplies a Double.dp extension, so the payload's number converts
      // directly.
      cornerRadius = json.optDouble("cornerRadius", 12.0).dp,
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
