import XCTest
@testable import LanguageSrsClient

/**
 The client against a real server.

 Skipped unless `LANGUAGESRS_API` points at one, so a clone with no backend
 running still has a green build:

     npm run server                                    # :4000
     LANGUAGESRS_API=http://localhost:4000 swift test

 These are the tests that catch a wrong field name or a route that moved. Writing
 the Kotlin models from reading the TypeScript produced two mistakes that
 compiled perfectly and failed silently — a 409 body whose state is nested under
 `current`, and a sitting that records `recalled` rather than `correct` — and
 nothing but a real server would have found either.
 */
final class IntegrationTests: XCTestCase {
    private var base: URL? {
        guard let raw = ProcessInfo.processInfo.environment["LANGUAGESRS_API"], !raw.isEmpty else {
            return nil
        }
        return URL(string: raw)
    }

    /// Skips rather than fails when there is no server to talk to.
    private func client(device: String = "swift-tests") throws -> LanguageSrsClient {
        guard let base else { throw XCTSkip("LANGUAGESRS_API is not set") }
        return LanguageSrsClient(baseURL: base, device: device)
    }

    /// A fresh account per test, so tests cannot interfere with one another.
    private func signedIn() async throws -> LanguageSrsClient {
        let api = try client()
        try await api.register(
            email: "swift-\(UInt64.random(in: 0...UInt64.max))@example.com",
            password: "a-long-enough-password",
            displayName: "Swift"
        )
        return api
    }

    func testRegistersAndReadsItselfBack() async throws {
        let api = try await signedIn()
        let me = try await api.me()

        XCTAssertTrue(me.user.email.hasPrefix("swift-"))
        XCTAssertEqual(me.user.displayName, "Swift")
        XCTAssertFalse(me.sessionId.isEmpty)
    }

    func testRefusesACallWithoutAToken() async throws {
        let api = try client()
        do {
            _ = try await api.me()
            XCTFail("expected to be refused")
        } catch is NotSignedIn {
            // Caught locally rather than sent: there is nothing a server could
            // usefully say about a request with no credentials.
        }
    }

    func testReportsTheServersOwnErrorCode() async throws {
        let api = try client()
        do {
            _ = try await api.signIn(email: "nobody-\(UInt64.random(in: 0...9999))@example.com", password: "a-long-enough-password")
            XCTFail("expected a refusal")
        } catch let error as ApiError {
            XCTAssertEqual(error.status, 401)
            // The code is what an app branches on; the message is for a person.
            XCTAssertEqual(error.code, "invalid_credentials")
        }
    }

    func testServesThePublishedWordListsWithoutAToken() async throws {
        let api = try client()
        let manifest = try await api.vocabulary()

        XCTAssertFalse(manifest.levelIds.isEmpty, "no levels in the manifest")
        XCTAssertGreaterThan(manifest.totalWords, 0)

        let level = try await api.vocabularyLevel(try XCTUnwrap(manifest.levelIds.first))
        XCTAssertFalse(level.entries.isEmpty, "no entries in \(level.levelId)")
        XCTAssertEqual(level.version, manifest.version)
    }

    func testRoundTripsState() async throws {
        let api = try await signedIn()
        let initial = try await api.getState()
        XCTAssertEqual(initial.revision, 0)

        let written = try await api.putState(
            baseRevision: initial.revision,
            values: ["srs:v1:meta": #"{"activeLanguage":"ja"}"#]
        )
        XCTAssertEqual(written.revision, 1)

        let stored = try await api.getState()
        XCTAssertEqual(stored.values["srs:v1:meta"], #"{"activeLanguage":"ja"}"#)
    }

    func testRefusesAWriteBasedOnAStaleRevision() async throws {
        let api = try await signedIn()
        _ = try await api.putState(baseRevision: 0, values: ["srs:v1:meta": "{}"])

        do {
            _ = try await api.putState(baseRevision: 0, values: ["srs:v1:meta": #"{"stale":true}"#])
            XCTFail("expected a conflict")
        } catch let conflict as StateConflict {
            // The server hands its state back precisely so the client can merge.
            XCTAssertEqual(conflict.current?.revision, 1)
        }
    }

    func testMergesTwoDevicesRatherThanLettingOneOverwriteTheOther() async throws {
        let laptop = try await signedIn()
        let phone = try client(device: "phone")
        let token = await laptop.currentToken
        await phone.useToken(token)

        func review(_ id: String, _ at: String) -> String {
            #"{"id":"\#(id)","cardId":"zh-nihao:recognition","reviewedAt":"\#(at)","rating":3}"#
        }

        // The laptop syncs first and the phone's base revision goes stale.
        _ = try await laptop.putState(
            baseRevision: 0,
            values: [StateMerge.logsKey: "[\(review("r_laptop", "2026-03-01T09:00:00.000Z"))]"]
        )

        let outcome = try await phone.syncState(
            local: [StateMerge.logsKey: "[\(review("r_phone", "2026-03-01T10:00:00.000Z"))]"],
            baseRevision: 0
        )

        // Both reviews survive. Without the merge the phone's write would either
        // be rejected forever or would delete the laptop's study.
        XCTAssertEqual(outcome.revision, 2)
        XCTAssertEqual(outcome.localOnlyReviews, 1)
        XCTAssertEqual(outcome.remoteOnlyReviews, 1)

        // Fetched into a local first: XCTUnwrap takes an autoclosure, which
        // cannot await.
        let laptopState = try await laptop.getState()
        let stored = try XCTUnwrap(laptopState.values[StateMerge.logsKey])
        XCTAssertTrue(stored.contains("r_laptop"), "laptop's review was lost: \(stored)")
        XCTAssertTrue(stored.contains("r_phone"), "phone's review was lost: \(stored)")
    }

    func testFoldsStudySittingsInById() async throws {
        let api = try await signedIn()
        let sitting = StudySessionRecord(
            id: "sit-1",
            languageCode: "zh",
            startedAt: "2026-03-01T09:00:00.000Z",
            endedAt: "2026-03-01T09:12:00.000Z",
            reviewed: 20,
            recalled: 17,
            activeMs: 612_000
        )

        var merged = try await api.addStudySessions([sitting])
        XCTAssertEqual(merged.count, 1)

        // Sent twice is safe: they are append-only and immutable once finished.
        merged = try await api.addStudySessions([sitting])
        XCTAssertEqual(merged.count, 1)

        let listed = try await api.studySessions()
        XCTAssertEqual(listed.count, 1)
        XCTAssertEqual(listed.first?.recalled, 17)
    }
}
