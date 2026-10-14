import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// A refusal from the server, with the code the app branches on.
public struct ApiError: Error, Equatable, Sendable {
    public let status: Int
    public let code: String
    public let message: String
}

/**
 Somebody else wrote first.

 Carries the server's current state when it could be read, because merging needs
 it. A nil means the conflict body itself could not be parsed, which is a reason
 to refetch rather than to discard anything.
 */
public struct StateConflict: Error, Sendable {
    public let current: AccountState?
}

/// Raised before a request is sent, when there is no token to send with it.
public struct NotSignedIn: Error, Sendable {
    public let path: String
}

/**
 The API, from Swift.

 Everything an iOS app needs to sign in, read the published word lists and sync a
 deck between devices. It holds no study logic and never will — the scheduler
 lives in one place, and a second implementation of FSRS written to make an
 iPhone build work is the exact failure this arrangement exists to prevent.

 An actor, so the token cannot be read while it is being replaced. A client is
 shared by every screen of an app and sign-in happens on one of them.
 */
public actor LanguageSrsClient {
    private let baseURL: URL
    private let session: URLSession
    /// Named in session lists, so somebody can recognise which device to revoke.
    private let device: String

    private var token: String?

    private let encoder: JSONEncoder = {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        return encoder
    }()
    private let decoder = JSONDecoder()

    public init(baseURL: URL, session: URLSession = .shared, device: String = "ios") {
        self.baseURL = baseURL
        self.session = session
        self.device = device
    }

    public func useToken(_ value: String?) {
        token = value
    }

    public var currentToken: String? { token }

    // MARK: - Auth

    @discardableResult
    public func register(email: String, password: String, displayName: String? = nil) async throws -> AuthResult {
        var body: [String: String] = ["email": email, "password": password, "device": device]
        if let displayName { body["displayName"] = displayName }

        let result: AuthResult = try await send(.post, "/auth/register", body: body, authenticated: false)
        token = result.token
        return result
    }

    @discardableResult
    public func signIn(email: String, password: String) async throws -> AuthResult {
        let body = ["email": email, "password": password, "device": device]
        let result: AuthResult = try await send(.post, "/auth/login", body: body, authenticated: false)
        token = result.token
        return result
    }

    public func me() async throws -> MeResponse {
        try await send(.get, "/auth/me")
    }

    public func sessions() async throws -> [SessionInfo] {
        let response: SessionsResponse = try await send(.get, "/auth/sessions")
        return response.sessions
    }

    public func signOut() async throws {
        try await sendIgnoringBody(.post, "/auth/logout", body: [String: String]())
        token = nil
    }

    /// Ends every other session. For "sign out my old phone".
    public func signOutOthers() async throws {
        try await sendIgnoringBody(.post, "/auth/logout-others", body: [String: String]())
    }

    // MARK: - Sync

    public func getState() async throws -> AccountState {
        try await send(.get, "/state")
    }

    /**
     Write the account's state, if nobody else has written since.

     Throws `StateConflict` when they have, carrying the server's current state.
     That is not a failure to handle away: it is the server declining to let this
     device overwrite another's work, and the answer is to merge and write again
     — see `syncState`.
     */
    @discardableResult
    public func putState(baseRevision: Int, values: [String: String]) async throws -> StatePutResponse {
        let request = StatePutRequest(baseRevision: baseRevision, device: device, values: values)
        let (data, response) = try await perform(.put, "/state", body: try encoder.encode(request), authenticated: true)

        if response.statusCode == 409 {
            // The server hands back what it has, precisely so the caller can
            // reconcile rather than guess — nested under `current`.
            let body = try? decoder.decode(StateConflictBody.self, from: data)
            throw StateConflict(current: body?.current)
        }

        return try decodeOrThrow(data, response)
    }

    // MARK: - Sittings

    public func studySessions() async throws -> [StudySessionRecord] {
        let response: StudySessionsResponse = try await send(.get, "/study-sessions")
        return response.sessions
    }

    /// Upload sittings. The server folds them in by id, so sending one twice is safe.
    @discardableResult
    public func addStudySessions(_ sessions: [StudySessionRecord]) async throws -> [StudySessionRecord] {
        let payload = try encoder.encode(StudySessionsResponse(sessions: sessions))
        let (data, response) = try await perform(.post, "/study-sessions", body: payload, authenticated: true)
        let decoded: StudySessionsResponse = try decodeOrThrow(data, response)
        return decoded.sessions
    }

    // MARK: - Vocabulary

    public func vocabulary() async throws -> VocabularyManifest {
        try await send(.get, "/vocabulary", authenticated: false)
    }

    public func vocabularyLevel(_ levelId: String) async throws -> VocabularyLevelResponse {
        try await send(.get, "/vocabulary/\(levelId)", authenticated: false)
    }

    public func health() async -> Bool {
        ((try? await perform(.get, "/health", body: nil, authenticated: false).1.statusCode) ?? 0) == 200
    }

    // MARK: - Plumbing

    private enum Method: String {
        case get = "GET", post = "POST", put = "PUT"
    }

    private func send<T: Decodable>(
        _ method: Method,
        _ path: String,
        body: [String: String]? = nil,
        authenticated: Bool = true
    ) async throws -> T {
        let encoded = body.map { try? encoder.encode($0) } ?? nil
        let (data, response) = try await perform(method, path, body: encoded, authenticated: authenticated)
        return try decodeOrThrow(data, response)
    }

    private func sendIgnoringBody(_ method: Method, _ path: String, body: [String: String]) async throws {
        let (data, response) = try await perform(method, path, body: try encoder.encode(body), authenticated: true)
        // 204 is the ordinary answer here, and has no body to decode.
        guard (200...299).contains(response.statusCode) else { throw error(from: data, response) }
    }

    private func perform(
        _ method: Method,
        _ path: String,
        body: Data?,
        authenticated: Bool
    ) async throws -> (Data, HTTPURLResponse) {
        var request = URLRequest(url: baseURL.appendingPathComponent(path.hasPrefix("/") ? String(path.dropFirst()) : path))
        request.httpMethod = method.rawValue

        if let body {
            request.httpBody = body
            request.setValue("application/json; charset=utf-8", forHTTPHeaderField: "Content-Type")
        }

        if authenticated {
            guard let token else { throw NotSignedIn(path: path) }
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }

        return try await data(for: request)
    }

    /**
     `URLSession.data(for:)`, by hand.

     The async overload is not available in Foundation on every platform this is
     built for, and this library is tested on Linux. A continuation around the
     completion-handler API behaves identically and compiles everywhere.
     */
    private func data(for request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        try await withCheckedThrowingContinuation { continuation in
            session.dataTask(with: request) { data, response, error in
                if let error {
                    continuation.resume(throwing: error)
                    return
                }
                guard let http = response as? HTTPURLResponse else {
                    continuation.resume(throwing: URLError(.badServerResponse))
                    return
                }
                continuation.resume(returning: (data ?? Data(), http))
            }.resume()
        }
    }

    private func decodeOrThrow<T: Decodable>(_ data: Data, _ response: HTTPURLResponse) throws -> T {
        guard (200...299).contains(response.statusCode) else { throw error(from: data, response) }
        return try decoder.decode(T.self, from: data)
    }

    /// The server's own error, turned into something catchable.
    private func error(from data: Data, _ response: HTTPURLResponse) -> ApiError {
        let body = try? decoder.decode(ApiErrorBody.self, from: data)
        return ApiError(
            status: response.statusCode,
            code: body?.code ?? "",
            // The server's message is written for a person; falling back to the
            // status keeps that true when there is no body at all.
            message: body?.message.isEmpty == false ? body!.message : "HTTP \(response.statusCode)"
        )
    }
}
