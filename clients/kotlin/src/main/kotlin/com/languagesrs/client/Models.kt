package com.languagesrs.client

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/**
 * The API's shapes, as Kotlin.
 *
 * Hand-written against `apps/server`, deliberately. The obvious alternative is
 * to generate them from a `.proto`, and that is the right end state — but the
 * server speaks JSON today and inventing a contract it does not implement would
 * be describing a server that does not exist. These are small enough to keep
 * honest by hand until the contract is real.
 *
 * Every class is `@Serializable` with explicit names where Kotlin and the wire
 * disagree, so a field rename on either side is a compile error here rather than
 * a null at runtime on somebody's phone.
 */

@Serializable
data class PublicUser(
    val id: String,
    val email: String,
    val displayName: String,
    val createdAt: String,
)

/** What register and login both return. The token is held, never logged. */
@Serializable
data class AuthResult(
    val user: PublicUser,
    val token: String,
    val expiresAt: String,
)

@Serializable
data class MeResponse(
    val user: PublicUser,
    val sessionId: String,
    val expiresAt: String,
)

@Serializable
data class SessionInfo(
    val id: String,
    val device: String? = null,
    val createdAt: String? = null,
    val lastSeenAt: String? = null,
    val expiresAt: String? = null,
    /** True for the session this client is using. */
    val current: Boolean = false,
)

@Serializable
data class SessionsResponse(val sessions: List<SessionInfo> = emptyList())

/**
 * The account's synced state.
 *
 * `values` is the engine's own storage, key for key. The server stores it
 * without interpreting it — see `StateService` — which is why the revision is
 * the only thing it can reason about, and why a conflict has to come back here
 * to be resolved.
 */
@Serializable
data class AccountState(
    val revision: Int = 0,
    val updatedAt: String = "",
    val device: String = "",
    val values: Map<String, String> = emptyMap(),
)

@Serializable
data class StatePutRequest(
    val baseRevision: Int,
    val device: String,
    val values: Map<String, String>,
)

@Serializable
data class StatePutResponse(val revision: Int, val updatedAt: String)

/**
 * One sitting.
 *
 * `recalled` rather than `correct`, and `activeMs` rather than a duration: these
 * are the server's names, and a near-miss here decodes to a default instead of
 * failing, which is how a streak quietly reads zero.
 */
@Serializable
data class StudySessionRecord(
    val id: String,
    val languageCode: String,
    val startedAt: String,
    val endedAt: String,
    val reviewed: Int = 0,
    val recalled: Int = 0,
    /** Time actually spent answering, which is not wall-clock time. */
    val activeMs: Long = 0,
    val device: String? = null,
    /** True when reconstructed from review logs rather than recorded live. */
    val derived: Boolean = false,
)

@Serializable
data class StudySessionsResponse(val sessions: List<StudySessionRecord> = emptyList())

/**
 * What word lists this server publishes.
 *
 * Keyed by language, then by level, with the word count as the value —
 * `{"zh": {"levels": {"hsk3-1": 500}, "total": 5593}}`. Modelled as maps rather
 * than lists because that is what the server sends; an invented list shape here
 * compiled perfectly and decoded to nothing, which is precisely the failure the
 * integration test exists to catch.
 */
@Serializable
data class VocabularyLanguage(
    val levels: Map<String, Int> = emptyMap(),
    val total: Int = 0,
)

@Serializable
data class VocabularyManifest(
    val version: String = "",
    val languages: Map<String, VocabularyLanguage> = emptyMap(),
) {
    /** Every level id this server has, for picking one to download. */
    val levelIds: List<String>
        get() = languages.values.flatMap { it.levels.keys }

    val totalWords: Int
        get() = languages.values.sumOf { it.total }
}

/**
 * A word list.
 *
 * `entries` stays as raw JSON elements rather than a typed `LexicalEntry`: the
 * shape belongs to the core package and duplicating it here would be a second
 * definition to keep in step, for data this client only passes through to the
 * engine. When the scheduler is native this gains a real type.
 */
@Serializable
data class VocabularyLevelResponse(
    val levelId: String,
    val languageCode: String,
    val version: String,
    val entries: List<kotlinx.serialization.json.JsonElement> = emptyList(),
)

/** The server's error body, which is the same shape for every failure. */
@Serializable
data class ApiErrorBody(
    @SerialName("error") val code: String = "",
    val message: String = "",
)

/**
 * The 409 from `PUT /state`.
 *
 * The account's current state rides along *under* `current`, beside the usual
 * error fields — not as the body itself. Decoding the body as a bare
 * `AccountState` succeeds and yields revision 0, so a client that got this wrong
 * would retry against revision 0 forever and never notice.
 */
@Serializable
data class StateConflictBody(
    @SerialName("error") val code: String = "",
    val message: String = "",
    val current: AccountState? = null,
)
