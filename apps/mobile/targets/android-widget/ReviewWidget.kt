package com.languagesrs.app.widget

import android.content.Context
import android.content.Intent
import android.content.res.Configuration
import android.net.Uri
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.glance.ActionParameters
import androidx.glance.GlanceId
import androidx.glance.GlanceModifier
import androidx.glance.GlanceTheme
import androidx.glance.action.actionParametersOf
import androidx.glance.action.actionStartActivity
import androidx.glance.action.clickable
import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.appwidget.GlanceAppWidgetReceiver
import androidx.glance.appwidget.action.ActionCallback
import androidx.glance.appwidget.action.actionRunCallback
import androidx.glance.appwidget.cornerRadius
import androidx.glance.appwidget.provideContent
import androidx.glance.appwidget.updateAll
import androidx.glance.background
import androidx.glance.layout.Alignment
import androidx.glance.layout.Column
import androidx.glance.layout.Row
import androidx.glance.layout.Spacer
import androidx.glance.layout.fillMaxSize
import androidx.glance.layout.fillMaxWidth
import androidx.glance.layout.height
import androidx.glance.layout.padding
import androidx.glance.text.FontWeight
import androidx.glance.text.Text
import androidx.glance.text.TextStyle
import androidx.glance.unit.ColorProvider

/**
 * The Android home-screen widgets, built with Glance.
 *
 * Two receivers over one widget implementation:
 *
 *  - `ReviewWidgetProvider` — the next card with four grade buttons.
 *  - `SpotlightWidgetProvider` — a passive word-of-the-moment, no buttons, for
 *    learners who want exposure on the home screen without a to-do list on it.
 *
 * Grading happens in an `ActionCallback`, which runs in the widget's process. It
 * writes the tap to SharedPreferences and refreshes; the app replays it through
 * FSRS on next launch. As on iOS, nothing here computes an interval — the numbers
 * on the buttons came from `previewIntervals` in the payload.
 *
 * Colours come from `snapshot.theme`, which carries both the light and the dark
 * palette; the night-mode flag on the widget's own configuration picks between
 * them. So the widget follows the home screen's appearance rather than whichever
 * mode the app was last in when it wrote the payload, and holds no palette of its
 * own.
 */

/** Which face the widget shows. Set per receiver. */
enum class WidgetMode { REVIEW, SPOTLIGHT }

class ReviewWidget(private val mode: WidgetMode = WidgetMode.REVIEW) : GlanceAppWidget() {
  override suspend fun provideGlance(context: Context, id: GlanceId) {
    val snapshot = SnapshotStore.read(context)
    // Read here rather than inside the composable: the Context is already in hand,
    // and the uiMode flag is the value Android itself uses to decide night mode.
    val isDark = (context.resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) ==
      Configuration.UI_MODE_NIGHT_YES

    provideContent {
      GlanceTheme {
        WidgetBody(snapshot = snapshot, mode = mode, isDark = isDark)
      }
    }
  }
}

private fun provider(color: Color): ColorProvider = ColorProvider(color)

@Composable
private fun WidgetBody(snapshot: WidgetSnapshot?, mode: WidgetMode, isDark: Boolean) {
  if (snapshot == null) {
    PlaceholderBody(isDark)
    return
  }

  val theme = snapshot.theme.resolve(isDark)
  val radius = snapshot.theme.cornerRadius

  // In review mode the next due card leads and the spotlight is the fallback;
  // in spotlight mode that order is reversed.
  val card = if (mode == WidgetMode.SPOTLIGHT) {
    snapshot.spotlight ?: snapshot.nextCard
  } else {
    snapshot.nextCard ?: snapshot.spotlight
  }

  Column(
    modifier = GlanceModifier
      .fillMaxSize()
      .background(theme.canvas)
      .padding(12.dp)
      .clickable(actionStartActivity(openAppIntent(snapshot.actionDeepLink))),
  ) {
    Row(modifier = GlanceModifier.fillMaxWidth()) {
      Text(
        "${snapshot.languageEmoji} ${snapshot.examCaption}",
        style = TextStyle(color = provider(theme.inkMuted), fontSize = 11.sp),
      )
      Spacer(modifier = GlanceModifier.defaultWeight())
      if (snapshot.totalCount > 0) {
        Text(
          "${snapshot.totalCount} due",
          style = TextStyle(
            color = provider(theme.accent),
            fontSize = 11.sp,
            fontWeight = FontWeight.Bold,
          ),
        )
      }
    }

    Spacer(modifier = GlanceModifier.height(8.dp))

    if (card != null) {
      Text(
        card.promptHint,
        style = TextStyle(color = provider(theme.inkMuted), fontSize = 10.sp),
      )
      Text(
        card.prompt,
        maxLines = 2,
        style = TextStyle(
          color = provider(theme.ink),
          fontSize = 26.sp,
          fontWeight = FontWeight.Medium,
        ),
      )

      if (mode == WidgetMode.SPOTLIGHT) {
        Text(
          card.answer,
          maxLines = 2,
          style = TextStyle(color = provider(theme.inkMuted), fontSize = 13.sp),
        )
      }
    } else {
      Text(
        snapshot.readinessHeadline,
        maxLines = 3,
        style = TextStyle(color = provider(theme.ink), fontSize = 13.sp),
      )
    }

    Spacer(modifier = GlanceModifier.defaultWeight())

    if (mode == WidgetMode.REVIEW && snapshot.nextCard != null) {
      GradeRow(snapshot.nextCard, theme, radius)
    } else {
      Text(
        snapshot.emptyStateCaption.ifEmpty { snapshot.streakCaption },
        style = TextStyle(color = provider(theme.inkMuted), fontSize = 11.sp),
      )
    }
  }
}

/**
 * Shown when there is no readable payload.
 *
 * Uses the neutral fallback rather than a language theme: at this point the widget
 * does not know which language it belongs to. Opening the app republishes, so the
 * state clears itself.
 */
@Composable
private fun PlaceholderBody(isDark: Boolean) {
  val theme = WidgetTheme.FALLBACK.resolve(isDark)

  Column(
    modifier = GlanceModifier.fillMaxSize().background(theme.canvas).padding(12.dp),
    verticalAlignment = Alignment.CenterVertically,
    horizontalAlignment = Alignment.CenterHorizontally,
  ) {
    Text("Language SRS", style = TextStyle(color = provider(theme.inkMuted), fontSize = 12.sp))
    Text(
      "Open to sync",
      style = TextStyle(color = provider(theme.ink), fontSize = 16.sp, fontWeight = FontWeight.Bold),
    )
  }
}

@Composable
private fun GradeRow(card: WidgetCard, theme: WidgetPalette, radius: androidx.compose.ui.unit.Dp) {
  Row(modifier = GlanceModifier.fillMaxWidth()) {
    card.options.forEach { option ->
      val tint = theme.gradeColor(option.rating)

      Column(
        modifier = GlanceModifier
          .defaultWeight()
          .padding(2.dp)
          .background(theme.surface)
          .cornerRadius(radius)
          .padding(vertical = 6.dp)
          .clickable(
            actionRunCallback<GradeActionCallback>(
              actionParametersOf(
                GradeActionCallback.cardIdKey to card.cardId,
                GradeActionCallback.ratingKey to option.rating,
              ),
            ),
          ),
        horizontalAlignment = Alignment.CenterHorizontally,
      ) {
        Text(
          option.label,
          style = TextStyle(color = provider(tint), fontSize = 11.sp, fontWeight = FontWeight.Bold),
        )
        Text(
          option.interval,
          style = TextStyle(color = provider(theme.inkMuted), fontSize = 9.sp),
        )
      }
    }
  }
}

private fun openAppIntent(deepLink: String): Intent =
  Intent(Intent.ACTION_VIEW, Uri.parse(deepLink)).apply {
    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
  }

/**
 * Records a grade tap without launching the app.
 *
 * Runs in the widget's process, so it can only write to shared storage — which is
 * exactly what the pending-grade queue is for. `updateAll` re-renders so the
 * button press has visible feedback; the card itself does not advance until the
 * app replays the queue and republishes a payload.
 */
class GradeActionCallback : ActionCallback {
  override suspend fun onAction(
    context: Context,
    glanceId: GlanceId,
    parameters: ActionParameters,
  ) {
    val cardId = parameters[cardIdKey] ?: return
    val rating = parameters[ratingKey] ?: return

    SnapshotStore.appendPendingGrade(context, cardId, rating)
    ReviewWidget(WidgetMode.REVIEW).updateAll(context)
    ReviewWidget(WidgetMode.SPOTLIGHT).updateAll(context)
  }

  companion object {
    val cardIdKey = ActionParameters.Key<String>("cardId")
    val ratingKey = ActionParameters.Key<Int>("rating")
  }
}

class ReviewWidgetProvider : GlanceAppWidgetReceiver() {
  override val glanceAppWidget: GlanceAppWidget = ReviewWidget(WidgetMode.REVIEW)
}

class SpotlightWidgetProvider : GlanceAppWidgetReceiver() {
  override val glanceAppWidget: GlanceAppWidget = ReviewWidget(WidgetMode.SPOTLIGHT)
}
