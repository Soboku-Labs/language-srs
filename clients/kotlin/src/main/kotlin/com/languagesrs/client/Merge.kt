package com.languagesrs.client

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

/**
 * Merging two devices' state.
 *
 * `StateService` on the server says the 409 exists "so the app can decide rather
 * than silently clobbering another device". This is that decision, and until now
 * nothing implemented it — a conflict meant one side's study was simply thrown
 * away by whoever retried last.
 *
 * ## The rules, and why they differ per key
 *
 * The blob is the engine's storage, key for key. Each key needs its own rule,
 * because they are different kinds of thing:
 *
 * - **Review logs are a union, by id.** Append-only and uniquely identified, so
 *   there is no conflict to resolve — a learner who studied on both devices did
 *   all of that work and should keep all of it. This is the key that matters:
 *   streaks, retention and the per-kind breakdown are all computed from it.
 * - **Cards take the server's copy.** They look derivable from the reviews, and
 *   are not: the scheduler fuzzes due dates so a hundred cards learned in one
 *   evening do not all return in one evening, which means replaying the same
 *   reviews on two devices lands them a day or two apart with neither wrong.
 *   Somebody has to be the answer and the server is the one both devices reach.
 * - **Everything else takes the server's copy too.** Profiles, settings and
 *   imported vocabulary are small and last-writer-wins is survivable for them;
 *   a learner who changed their daily limit on their phone meant it.
 *
 * The asymmetry is the point. Taking the server's copy wholesale would be
 * simpler and would lose reviews, which is the one thing here that cannot be
 * recreated.
 */
object StateMerge {
    private val json = Json { ignoreUnknownKeys = true }

    /** The engine's key for the review log. Mirrors `STORAGE_KEYS.logs`. */
    const val LOGS_KEY: String = "srs:v1:logs"

    data class Result(
        val values: Map<String, String>,
        /** Reviews this device had that the server did not. */
        val localOnlyReviews: Int,
        /** Reviews the server had that this device did not. */
        val remoteOnlyReviews: Int,
    )

    /**
     * Combine what this device holds with what the server returned.
     *
     * Order within the merged log is by `reviewedAt`, because everything
     * computed from it reads it in order, and two devices appending
     * independently produce two sequences that only interleave correctly once
     * sorted.
     */
    fun merge(local: Map<String, String>, remote: Map<String, String>): Result {
        /*
         * Start from this device, then let the server overwrite.
         *
         * Starting from the server's map instead reads as the same thing and is
         * not: a key the server has never seen — imported vocabulary, on an
         * account that has only ever synced from a phone — would simply vanish.
         * The server's copy winning where both sides have a key is the rule;
         * "the server has not got it, so delete it" is not.
         */
        val merged = local.toMutableMap()
        merged.putAll(remote)

        val localLogs = parseLogs(local[LOGS_KEY])
        val remoteLogs = parseLogs(remote[LOGS_KEY])

        if (localLogs.isEmpty() && remoteLogs.isEmpty()) {
            return Result(merged, 0, 0)
        }

        val byId = LinkedHashMap<String, JsonElement>()
        for (log in remoteLogs) idOf(log)?.let { byId[it] = log }
        val remoteIds = byId.keys.toSet()

        var localOnly = 0
        for (log in localLogs) {
            val id = idOf(log) ?: continue
            if (id !in remoteIds) localOnly += 1
            // Put, not putIfAbsent: an id present on both sides describes the
            // same grading, so either copy is correct and the newer write wins
            // nothing either way.
            byId[id] = log
        }

        val localIds = localLogs.mapNotNull { idOf(it) }.toSet()
        val remoteOnly = remoteIds.count { it !in localIds }

        val ordered = byId.values.sortedBy { reviewedAt(it) }
        merged[LOGS_KEY] = json.encodeToString(JsonArray.serializer(), JsonArray(ordered))

        return Result(merged, localOnly, remoteOnly)
    }

    private fun parseLogs(raw: String?): List<JsonElement> {
        if (raw.isNullOrBlank()) return emptyList()
        return runCatching { json.parseToJsonElement(raw) }
            .getOrNull()
            ?.let { it as? JsonArray }
            // A corrupt log on either side is treated as empty rather than
            // thrown: the alternative is a sync that can never succeed again,
            // and the other side's copy is probably intact.
            ?: emptyList()
    }

    private fun idOf(log: JsonElement): String? =
        (log as? JsonObject)?.get("id")?.jsonPrimitive?.contentOrNull

    private fun reviewedAt(log: JsonElement): String =
        (log as? JsonObject)?.get("reviewedAt")?.jsonPrimitive?.contentOrNull ?: ""
}

/**
 * Push this device's state, merging if the server has moved on.
 *
 * The retry is bounded. One conflict is ordinary — another device synced while
 * this one was composing its write. A second in the same call means something is
 * writing continuously, and spinning would turn a busy account into a hot loop
 * against the server.
 */
fun LanguageSrsClient.syncState(
    local: Map<String, String>,
    baseRevision: Int,
    attempts: Int = 3,
): SyncOutcome {
    var values = local
    var revision = baseRevision
    var merged = StateMerge.Result(local, 0, 0)

    repeat(attempts) {
        try {
            val response = putState(revision, values)
            return SyncOutcome(
                revision = response.revision,
                values = values,
                localOnlyReviews = merged.localOnlyReviews,
                remoteOnlyReviews = merged.remoteOnlyReviews,
            )
        } catch (conflict: StateConflict) {
            // Refetch when the conflict body could not be read, rather than
            // assuming the server is empty and overwriting it with this device.
            val current = conflict.current ?: getState()
            merged = StateMerge.merge(values, current.values)
            values = merged.values
            revision = current.revision
        }
    }

    throw StateConflict(null)
}

data class SyncOutcome(
    val revision: Int,
    val values: Map<String, String>,
    val localOnlyReviews: Int,
    val remoteOnlyReviews: Int,
)
