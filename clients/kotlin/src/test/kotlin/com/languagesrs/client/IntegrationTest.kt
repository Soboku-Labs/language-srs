package com.languagesrs.client

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertTrue
import org.junit.jupiter.api.Assumptions.assumeTrue

/**
 * The client against a real server.
 *
 * Skipped unless `LANGUAGESRS_API` points at one, so a clone with no backend
 * running still has a green build:
 *
 *     npm run server                     # :4000
 *     LANGUAGESRS_API=http://localhost:4000 gradle test
 *
 * These are the tests that would have caught a wrong field name or a route that
 * moved, which no amount of unit testing against handmade JSON can do.
 */
class IntegrationTest {
    private val base: String = System.getenv("LANGUAGESRS_API").orEmpty()

    private fun client(): LanguageSrsClient {
        assumeTrue(base.isNotBlank(), "LANGUAGESRS_API is not set")
        return LanguageSrsClient(base, device = "kotlin-tests")
    }

    /** A fresh account per test, so tests cannot interfere with one another. */
    private fun signedIn(): LanguageSrsClient {
        val api = client()
        api.register(
            email = "kt-${System.nanoTime()}@example.com",
            password = "a-long-enough-password",
            displayName = "Kotlin",
        )
        return api
    }

    @Test
    fun `registers and reads itself back`() {
        val api = signedIn()
        val me = api.me()

        assertTrue(me.user.email.startsWith("kt-"))
        assertEquals("Kotlin", me.user.displayName)
        assertNotNull(me.sessionId)
    }

    @Test
    fun `refuses a call without a token`() {
        val api = client()
        val failure = runCatching { api.me() }.exceptionOrNull()
        // Before a token exists this is caught locally rather than sent — there
        // is nothing a server could usefully say about it.
        assertTrue(failure is IllegalStateException, "got $failure")
    }

    @Test
    fun `reports the server's own error code`() {
        val api = client()
        val failure = runCatching {
            api.signIn("nobody-${System.nanoTime()}@example.com", "a-long-enough-password")
        }.exceptionOrNull()

        assertTrue(failure is ApiException, "got $failure")
        assertEquals(401, failure.status)
        // The code is what an app branches on; the message is for a person.
        assertEquals("invalid_credentials", failure.code)
    }

    @Test
    fun `serves the published word lists without a token`() {
        val api = client()
        val manifest = api.vocabulary()

        assertTrue(manifest.levelIds.isNotEmpty(), "no levels in the manifest")
        assertTrue(manifest.totalWords > 0, "manifest reports no words")

        val level = api.vocabularyLevel(manifest.levelIds.first())
        assertTrue(level.entries.isNotEmpty(), "no entries in ${level.levelId}")
        assertEquals(manifest.version, level.version)
    }

    @Test
    fun `round-trips state`() {
        val api = signedIn()
        val initial = api.getState()
        assertEquals(0, initial.revision)

        val written = api.putState(initial.revision, mapOf("srs:v1:meta" to """{"activeLanguage":"ja"}"""))
        assertEquals(1, written.revision)
        assertEquals("""{"activeLanguage":"ja"}""", api.getState().values["srs:v1:meta"])
    }

    @Test
    fun `refuses a write based on a stale revision`() {
        val api = signedIn()
        api.putState(0, mapOf("srs:v1:meta" to "{}"))

        val conflict = runCatching { api.putState(0, mapOf("srs:v1:meta" to """{"stale":true}""")) }
            .exceptionOrNull()

        assertTrue(conflict is StateConflict, "got $conflict")
        // The server hands its state back precisely so the client can merge.
        assertEquals(1, conflict.current?.revision)
    }

    @Test
    fun `merges two devices rather than letting one overwrite the other`() {
        val laptop = signedIn()
        val phone = LanguageSrsClient(base, device = "phone").also { it.useToken(laptop.token) }

        val review = { id: String, at: String ->
            """{"id":"$id","cardId":"zh-nihao:recognition","reviewedAt":"$at","rating":3}"""
        }

        // The laptop syncs first and the phone's base revision goes stale.
        laptop.putState(0, mapOf(StateMerge.LOGS_KEY to "[${review("r_laptop", "2026-03-01T09:00:00.000Z")}]"))

        val outcome = phone.syncState(
            local = mapOf(StateMerge.LOGS_KEY to "[${review("r_phone", "2026-03-01T10:00:00.000Z")}]"),
            baseRevision = 0,
        )

        // Both reviews survive. Without the merge the phone's write would either
        // be rejected forever or would delete the laptop's study.
        assertEquals(2, outcome.revision)
        assertEquals(1, outcome.localOnlyReviews)
        assertEquals(1, outcome.remoteOnlyReviews)

        val stored = laptop.getState().values.getValue(StateMerge.LOGS_KEY)
        assertTrue(stored.contains("r_laptop"), "laptop's review was lost: $stored")
        assertTrue(stored.contains("r_phone"), "phone's review was lost: $stored")
    }

    @Test
    fun `folds study sittings in by id`() {
        val api = signedIn()
        val sitting = StudySessionRecord(
            id = "sit-1",
            languageCode = "zh",
            startedAt = "2026-03-01T09:00:00.000Z",
            endedAt = "2026-03-01T09:12:00.000Z",
            reviewed = 20,
            recalled = 17,
            activeMs = 612_000,
        )

        assertEquals(1, api.addStudySessions(listOf(sitting)).size)
        // Sent twice is safe: they are append-only and immutable once finished.
        assertEquals(1, api.addStudySessions(listOf(sitting)).size)
        assertEquals(1, api.studySessions().size)
    }
}
