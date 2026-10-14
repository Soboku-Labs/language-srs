package com.languagesrs.client

import java.io.IOException
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.serializer
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response

/**
 * The API, from Kotlin.
 *
 * Everything an Android app needs to sign in, read the published word lists and
 * sync a deck between devices. It holds no study logic and never will — the
 * scheduler lives in one place, and a second implementation of FSRS written to
 * make an Android build work is the exact failure this arrangement exists to
 * prevent.
 *
 * ## Why not Retrofit
 *
 * Nine endpoints. Retrofit would add an annotation processor and a second way to
 * describe the same calls, to save perhaps forty lines of request building. The
 * OkHttp dependency underneath it is the part that earns its place on Android,
 * and that is taken directly.
 */
class LanguageSrsClient(
    private val baseUrl: String,
    private val http: OkHttpClient = OkHttpClient(),
    /** Named in session lists, so somebody can recognise which device to revoke. */
    private val device: String = "android",
) {
    private val json = Json {
        ignoreUnknownKeys = true
        encodeDefaults = true
    }
    private val jsonType = "application/json; charset=utf-8".toMediaType()

    /** The bearer token, once signed in. Held in memory; persisting it is the app's job. */
    var token: String? = null
        private set

    fun useToken(value: String?) {
        token = value
    }

    // ------------------------------------------------------------------ auth

    fun register(email: String, password: String, displayName: String? = null): AuthResult =
        post(
            "/auth/register",
            buildString {
                append("""{"email":${quote(email)},"password":${quote(password)}""")
                if (displayName != null) append(""","displayName":${quote(displayName)}""")
                append(""","device":${quote(device)}}""")
            },
            authenticated = false,
        ).let { decode<AuthResult>(it).also { result -> token = result.token } }

    fun signIn(email: String, password: String): AuthResult =
        post(
            "/auth/login",
            """{"email":${quote(email)},"password":${quote(password)},"device":${quote(device)}}""",
            authenticated = false,
        ).let { decode<AuthResult>(it).also { result -> token = result.token } }

    fun me(): MeResponse = decode(get("/auth/me"))

    fun sessions(): List<SessionInfo> = decode<SessionsResponse>(get("/auth/sessions")).sessions

    fun signOut() {
        post("/auth/logout", "{}")
        token = null
    }

    /** Ends every other session. For "sign out my old phone". */
    fun signOutOthers() {
        post("/auth/logout-others", "{}")
    }

    // ------------------------------------------------------------------ sync

    fun getState(): AccountState = decode(get("/state"))

    /**
     * Write the account's state, if nobody else has written since.
     *
     * Throws [StateConflict] when they have, carrying the server's current
     * state. That is not a failure to handle away: it is the server declining to
     * let this device overwrite another's work, and the answer is to merge and
     * write again — see [syncState].
     */
    fun putState(baseRevision: Int, values: Map<String, String>): StatePutResponse {
        val body = json.encodeToString(
            StatePutRequest.serializer(),
            StatePutRequest(baseRevision = baseRevision, device = device, values = values),
        )

        val response = request("PUT", "/state", body)
        response.use {
            if (it.code == 409) {
                // The server hands back what it has, precisely so the caller can
                // reconcile rather than guess — nested under `current`.
                val body = runCatching {
                    json.decodeFromString(StateConflictBody.serializer(), it.body?.string().orEmpty())
                }.getOrNull()
                throw StateConflict(body?.current)
            }
            return decode(readOrThrow(it))
        }
    }

    // ------------------------------------------------------------- sittings

    fun studySessions(): List<StudySessionRecord> =
        decode<StudySessionsResponse>(get("/study-sessions")).sessions

    /** Upload sittings. The server folds them in by id, so sending one twice is safe. */
    fun addStudySessions(sessions: List<StudySessionRecord>): List<StudySessionRecord> {
        val body = buildString {
            append("""{"sessions":""")
            append(json.encodeToString(ListSerializer(StudySessionRecord.serializer()), sessions))
            append("}")
        }
        return decode<StudySessionsResponse>(post("/study-sessions", body)).sessions
    }

    // ----------------------------------------------------------- vocabulary

    fun vocabulary(): VocabularyManifest = decode(get("/vocabulary", authenticated = false))

    fun vocabularyLevel(levelId: String): VocabularyLevelResponse =
        decode(get("/vocabulary/$levelId", authenticated = false))

    fun health(): Boolean = runCatching { get("/health", authenticated = false) }.isSuccess

    // ------------------------------------------------------------- plumbing

    private fun url(path: String) = (baseUrl.trimEnd('/') + path).toHttpUrl()

    private fun get(path: String, authenticated: Boolean = true): String =
        request("GET", path, null, authenticated).use { readOrThrow(it) }

    private fun post(path: String, body: String, authenticated: Boolean = true): String =
        request("POST", path, body, authenticated).use { readOrThrow(it) }

    private fun request(
        method: String,
        path: String,
        body: String?,
        authenticated: Boolean = true,
    ): Response {
        val builder = Request.Builder().url(url(path))
        when (method) {
            "GET" -> builder.get()
            "PUT" -> builder.put((body ?: "{}").toRequestBody(jsonType))
            "POST" -> builder.post((body ?: "{}").toRequestBody(jsonType))
            else -> throw IllegalArgumentException("Unsupported method $method")
        }

        if (authenticated) {
            val bearer = token ?: throw IllegalStateException("Sign in before calling $path.")
            builder.header("Authorization", "Bearer $bearer")
        }

        return http.newCall(builder.build()).execute()
    }

    /** The body, or the server's own error turned into something catchable. */
    private fun readOrThrow(response: Response): String {
        val text = response.body?.string().orEmpty()
        if (response.isSuccessful) return text

        val parsed = runCatching { json.decodeFromString(ApiErrorBody.serializer(), text) }.getOrNull()
        throw ApiException(
            status = response.code,
            code = parsed?.code.orEmpty(),
            // The server's message is written for a person; falling back to the
            // status line keeps that true when there is no body at all.
            message = parsed?.message?.takeIf { it.isNotBlank() } ?: "HTTP ${response.code}",
        )
    }

    private inline fun <reified T> decode(text: String): T =
        json.decodeFromString(serializer<T>(), text)

    /** A JSON string literal, escaped — an email with a quote in it is still an email. */
    private fun quote(value: String) = JsonPrimitive(value).toString()
}

/** A refusal from the server, with the code the app branches on. */
class ApiException(val status: Int, val code: String, message: String) : IOException(message)

/**
 * Somebody else wrote first.
 *
 * Carries the server's current state when it could be read, because merging
 * needs it. A null means the conflict body itself could not be parsed, which is
 * a reason to refetch rather than to discard anything.
 */
class StateConflict(val current: AccountState?) :
    IOException("The account's state has moved on since this device last read it.")
