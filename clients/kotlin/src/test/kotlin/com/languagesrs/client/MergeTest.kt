package com.languagesrs.client

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonPrimitive

/**
 * The merge rules, against handmade state.
 *
 * Unit tests rather than two devices and a server, because the rules are the
 * part worth pinning: what gets kept, what gets taken, and what order the result
 * is in. The integration test drives the real thing.
 */
class MergeTest {
    private val json = Json

    private fun log(id: String, at: String) =
        """{"id":"$id","cardId":"zh-nihao:recognition","reviewedAt":"$at","rating":3}"""

    private fun logs(vararg entries: String) = "[${entries.joinToString(",")}]"

    private fun idsIn(values: Map<String, String>): List<String> {
        val array = json.parseToJsonElement(values.getValue(StateMerge.LOGS_KEY)) as JsonArray
        return array.map { (it as JsonObject).getValue("id").jsonPrimitive.contentOrNull!! }
    }

    @Test
    fun `keeps reviews from both devices`() {
        val local = mapOf(StateMerge.LOGS_KEY to logs(log("r_a", "2026-03-01T09:00:00.000Z")))
        val remote = mapOf(StateMerge.LOGS_KEY to logs(log("r_b", "2026-03-01T10:00:00.000Z")))

        val merged = StateMerge.merge(local, remote)

        // The whole point: a learner who studied on their laptop and their phone
        // did all of that work.
        assertEquals(listOf("r_a", "r_b"), idsIn(merged.values))
        assertEquals(1, merged.localOnlyReviews)
        assertEquals(1, merged.remoteOnlyReviews)
    }

    @Test
    fun `orders the merged log by when reviews happened`() {
        val local = mapOf(
            StateMerge.LOGS_KEY to logs(
                log("r_late", "2026-03-01T18:00:00.000Z"),
                log("r_early", "2026-03-01T08:00:00.000Z"),
            ),
        )
        val remote = mapOf(StateMerge.LOGS_KEY to logs(log("r_mid", "2026-03-01T12:00:00.000Z")))

        // Everything computed from the log — streaks, retention windows — reads
        // it in order, and two devices appending independently do not interleave
        // on their own.
        assertEquals(listOf("r_early", "r_mid", "r_late"), idsIn(StateMerge.merge(local, remote).values))
    }

    @Test
    fun `counts a review both devices have only once`() {
        val shared = logs(log("r_same", "2026-03-01T09:00:00.000Z"))
        val merged = StateMerge.merge(
            mapOf(StateMerge.LOGS_KEY to shared),
            mapOf(StateMerge.LOGS_KEY to shared),
        )

        assertEquals(listOf("r_same"), idsIn(merged.values))
        assertEquals(0, merged.localOnlyReviews)
        assertEquals(0, merged.remoteOnlyReviews)
    }

    @Test
    fun `takes the server's cards rather than this device's`() {
        val local = mapOf("srs:v1:cards" to """[{"id":"c1","due":"2026-03-10T00:00:00.000Z"}]""")
        val remote = mapOf("srs:v1:cards" to """[{"id":"c1","due":"2026-03-14T00:00:00.000Z"}]""")

        // Not the later date, not a merge — the server's, because fuzzed due
        // dates mean both are plausible and only one can be the answer.
        assertEquals(remote["srs:v1:cards"], StateMerge.merge(local, remote).values["srs:v1:cards"])
    }

    @Test
    fun `keeps a key only this device has`() {
        val merged = StateMerge.merge(mapOf("srs:v1:entries" to "[]"), emptyMap())
        // A server that has never seen imported vocabulary must not be read as
        // an instruction to delete it.
        assertTrue(merged.values.containsKey("srs:v1:entries"))
    }

    @Test
    fun `survives a corrupt log on either side`() {
        val good = logs(log("r_a", "2026-03-01T09:00:00.000Z"))

        // Treated as empty rather than thrown: the alternative is an account
        // that can never sync again.
        assertEquals(listOf("r_a"), idsIn(StateMerge.merge(mapOf(StateMerge.LOGS_KEY to "not json"), mapOf(StateMerge.LOGS_KEY to good)).values))
        assertEquals(listOf("r_a"), idsIn(StateMerge.merge(mapOf(StateMerge.LOGS_KEY to good), mapOf(StateMerge.LOGS_KEY to "{}")).values))
    }

    @Test
    fun `leaves state alone when neither side has reviews`() {
        val merged = StateMerge.merge(mapOf("srs:v1:meta" to "{}"), mapOf("srs:v1:meta" to """{"activeLanguage":"ja"}"""))
        assertEquals("""{"activeLanguage":"ja"}""", merged.values["srs:v1:meta"])
        assertTrue(StateMerge.LOGS_KEY !in merged.values)
    }
}
