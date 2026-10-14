import XCTest
@testable import LanguageSrsClient

/**
 The merge rules, against handmade state.

 Deliberately the same cases as `clients/kotlin`'s `MergeTest`, assertion for
 assertion. Two apps that resolve the same conflict differently would produce two
 different accounts, and the cheapest way to keep them honest is for both test
 suites to make the same claims.
 */
final class MergeTests: XCTestCase {
    private func log(_ id: String, _ at: String) -> String {
        #"{"id":"\#(id)","cardId":"zh-nihao:recognition","reviewedAt":"\#(at)","rating":3}"#
    }

    private func logs(_ entries: String...) -> String {
        "[\(entries.joined(separator: ","))]"
    }

    private func ids(in values: [String: String]) throws -> [String] {
        let raw = try XCTUnwrap(values[StateMerge.logsKey])
        let data = try XCTUnwrap(raw.data(using: .utf8))
        guard case .array(let entries) = try JSONDecoder().decode(JSONValue.self, from: data) else {
            return []
        }
        return entries.compactMap { $0.string("id") }
    }

    func testKeepsReviewsFromBothDevices() throws {
        let local = [StateMerge.logsKey: logs(log("r_a", "2026-03-01T09:00:00.000Z"))]
        let remote = [StateMerge.logsKey: logs(log("r_b", "2026-03-01T10:00:00.000Z"))]

        let merged = StateMerge.merge(local: local, remote: remote)

        // The whole point: a learner who studied on their laptop and their phone
        // did all of that work.
        XCTAssertEqual(try ids(in: merged.values), ["r_a", "r_b"])
        XCTAssertEqual(merged.localOnlyReviews, 1)
        XCTAssertEqual(merged.remoteOnlyReviews, 1)
    }

    func testOrdersTheMergedLogByWhenReviewsHappened() throws {
        let local = [
            StateMerge.logsKey: logs(
                log("r_late", "2026-03-01T18:00:00.000Z"),
                log("r_early", "2026-03-01T08:00:00.000Z")
            )
        ]
        let remote = [StateMerge.logsKey: logs(log("r_mid", "2026-03-01T12:00:00.000Z"))]

        // Everything computed from the log reads it in order, and two devices
        // appending independently do not interleave on their own.
        let merged = StateMerge.merge(local: local, remote: remote)
        XCTAssertEqual(try ids(in: merged.values), ["r_early", "r_mid", "r_late"])
    }

    func testCountsAReviewBothDevicesHaveOnlyOnce() throws {
        let shared = [StateMerge.logsKey: logs(log("r_same", "2026-03-01T09:00:00.000Z"))]
        let merged = StateMerge.merge(local: shared, remote: shared)

        XCTAssertEqual(try ids(in: merged.values), ["r_same"])
        XCTAssertEqual(merged.localOnlyReviews, 0)
        XCTAssertEqual(merged.remoteOnlyReviews, 0)
    }

    func testTakesTheServersCardsRatherThanThisDevices() {
        let local = ["srs:v1:cards": #"[{"id":"c1","due":"2026-03-10T00:00:00.000Z"}]"#]
        let remote = ["srs:v1:cards": #"[{"id":"c1","due":"2026-03-14T00:00:00.000Z"}]"#]

        // Not the later date, not a merge — the server's, because fuzzed due
        // dates mean both are plausible and only one can be the answer.
        let merged = StateMerge.merge(local: local, remote: remote)
        XCTAssertEqual(merged.values["srs:v1:cards"], remote["srs:v1:cards"])
    }

    func testKeepsAKeyOnlyThisDeviceHas() {
        let merged = StateMerge.merge(local: ["srs:v1:entries": "[]"], remote: [:])
        // A server that has never seen imported vocabulary must not be read as
        // an instruction to delete it.
        XCTAssertNotNil(merged.values["srs:v1:entries"])
    }

    func testSurvivesACorruptLogOnEitherSide() throws {
        let good = logs(log("r_a", "2026-03-01T09:00:00.000Z"))

        // Treated as empty rather than thrown: the alternative is an account
        // that can never sync again.
        let localCorrupt = StateMerge.merge(
            local: [StateMerge.logsKey: "not json"],
            remote: [StateMerge.logsKey: good]
        )
        XCTAssertEqual(try ids(in: localCorrupt.values), ["r_a"])

        let remoteCorrupt = StateMerge.merge(
            local: [StateMerge.logsKey: good],
            remote: [StateMerge.logsKey: "{}"]
        )
        XCTAssertEqual(try ids(in: remoteCorrupt.values), ["r_a"])
    }

    func testLeavesStateAloneWhenNeitherSideHasReviews() {
        let merged = StateMerge.merge(
            local: ["srs:v1:meta": "{}"],
            remote: ["srs:v1:meta": #"{"activeLanguage":"ja"}"#]
        )

        XCTAssertEqual(merged.values["srs:v1:meta"], #"{"activeLanguage":"ja"}"#)
        XCTAssertNil(merged.values[StateMerge.logsKey])
    }

    func testReEncodesRatingsAsIntegers() throws {
        // JSON has one number type, so everything decodes as Double. Re-encoding
        // a rating of 3 as `3.0` is accepted by the server and makes every diff
        // during debugging harder to read than it needs to be.
        let merged = StateMerge.merge(
            local: [StateMerge.logsKey: logs(log("r_a", "2026-03-01T09:00:00.000Z"))],
            remote: [:]
        )
        let encoded = try XCTUnwrap(merged.values[StateMerge.logsKey])
        XCTAssertTrue(encoded.contains(#""rating":3"#), "re-encoded as: \(encoded)")
    }
}
