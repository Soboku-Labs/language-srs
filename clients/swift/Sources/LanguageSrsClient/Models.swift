import Foundation

/**
 The API's shapes, as Swift.

 Hand-written against `apps/server`, and kept deliberately parallel to
 `clients/kotlin` — same names, same optionality, same defaults — so that when
 the two apps disagree about something it is a real disagreement and not a
 translation error.

 Two of these were wrong when first written from reading the TypeScript, and the
 integration tests caught both. Both failures were silent rather than loud, which
 is the thing to notice: a near-miss in a `Codable` type decodes to a default or
 throws somewhere unhelpful, and neither looks like "the field is called
 something else".
 */

public struct PublicUser: Codable, Equatable, Sendable {
    public let id: String
    public let email: String
    public let displayName: String
    public let createdAt: String
}

/// What register and login both return. The token is held, never logged.
public struct AuthResult: Codable, Equatable, Sendable {
    public let user: PublicUser
    public let token: String
    public let expiresAt: String
}

public struct MeResponse: Codable, Equatable, Sendable {
    public let user: PublicUser
    public let sessionId: String
    public let expiresAt: String
}

public struct SessionInfo: Codable, Equatable, Sendable {
    public let id: String
    public var device: String?
    public var createdAt: String?
    public var lastSeenAt: String?
    public var expiresAt: String?
    /// True for the session this client is using.
    public var current: Bool?
}

struct SessionsResponse: Codable {
    let sessions: [SessionInfo]
}

/**
 The account's synced state.

 `values` is the engine's own storage, key for key. The server stores it without
 interpreting it — see `StateService` — which is why the revision is the only
 thing it can reason about, and why a conflict has to come back here to be
 resolved.
 */
public struct AccountState: Codable, Equatable, Sendable {
    public var revision: Int
    public var updatedAt: String
    public var device: String
    public var values: [String: String]

    public init(revision: Int = 0, updatedAt: String = "", device: String = "", values: [String: String] = [:]) {
        self.revision = revision
        self.updatedAt = updatedAt
        self.device = device
        self.values = values
    }
}

struct StatePutRequest: Codable {
    let baseRevision: Int
    let device: String
    let values: [String: String]
}

public struct StatePutResponse: Codable, Equatable, Sendable {
    public let revision: Int
    public let updatedAt: String
}

/**
 One sitting.

 `recalled` rather than `correct`, and `activeMs` rather than a duration: these
 are the server's names. A near-miss here is not a compile error and not a
 crash — it decodes to a default, which is how a streak quietly reads zero.
 */
public struct StudySessionRecord: Codable, Equatable, Sendable {
    public let id: String
    public let languageCode: String
    public let startedAt: String
    public let endedAt: String
    public var reviewed: Int
    public var recalled: Int
    /// Time actually spent answering, which is not wall-clock time.
    public var activeMs: Int
    public var device: String?
    /// True when reconstructed from review logs rather than recorded live.
    public var derived: Bool?

    public init(
        id: String,
        languageCode: String,
        startedAt: String,
        endedAt: String,
        reviewed: Int = 0,
        recalled: Int = 0,
        activeMs: Int = 0,
        device: String? = nil,
        derived: Bool? = nil
    ) {
        self.id = id
        self.languageCode = languageCode
        self.startedAt = startedAt
        self.endedAt = endedAt
        self.reviewed = reviewed
        self.recalled = recalled
        self.activeMs = activeMs
        self.device = device
        self.derived = derived
    }
}

struct StudySessionsResponse: Codable {
    let sessions: [StudySessionRecord]
}

/**
 What word lists this server publishes.

 Keyed by language, then by level, with the word count as the value —
 `{"zh": {"levels": {"hsk3-1": 500}, "total": 5593}}`. Modelled as dictionaries
 because that is what the server sends; an invented array shape compiles
 perfectly and decodes to nothing.
 */
public struct VocabularyLanguage: Codable, Equatable, Sendable {
    public var levels: [String: Int]
    public var total: Int
}

public struct VocabularyManifest: Codable, Equatable, Sendable {
    public var version: String
    public var languages: [String: VocabularyLanguage]

    /// Every level id this server has, sorted so the order is stable to assert on.
    public var levelIds: [String] {
        languages.values.flatMap { $0.levels.keys }.sorted()
    }

    public var totalWords: Int {
        languages.values.reduce(0) { $0 + $1.total }
    }
}

/**
 A word list.

 `entries` stays as loosely-typed JSON rather than a `LexicalEntry`: that shape
 belongs to the core package, and duplicating it here would be a second
 definition to keep in step for data this client only passes through to the
 engine. It gains a real type when the scheduler is native.
 */
public struct VocabularyLevelResponse: Codable, Equatable, Sendable {
    public let levelId: String
    public let languageCode: String
    public let version: String
    public let entries: [JSONValue]
}

/// The server's error body, which is the same shape for every failure.
struct ApiErrorBody: Codable {
    let code: String
    let message: String

    enum CodingKeys: String, CodingKey {
        case code = "error"
        case message
    }
}

/**
 The 409 from `PUT /state`.

 The account's current state rides along *under* `current`, beside the usual
 error fields — not as the body itself. Decoding the body as a bare
 `AccountState` succeeds and yields revision 0, so a client that got this wrong
 would retry against revision 0 forever and never fail loudly.
 */
struct StateConflictBody: Codable {
    let code: String
    let message: String
    let current: AccountState?

    enum CodingKeys: String, CodingKey {
        case code = "error"
        case message
        case current
    }
}
