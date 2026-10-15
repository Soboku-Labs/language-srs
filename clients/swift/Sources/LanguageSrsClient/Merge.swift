import Foundation

/**
 Merging two devices' state.

 `StateService` on the server says the 409 exists "so the app can decide rather
 than silently clobbering another device". This is that decision, and it is the
 same decision `clients/kotlin` makes — deliberately so. Two apps that resolve
 the same conflict differently would produce two different accounts.

 ## The rules, and why they differ per key

 The blob is the engine's storage, key for key, and each key needs its own rule:

 - **Review logs are a union, by id.** Append-only and uniquely identified, so
   there is no conflict to resolve — a learner who studied on both devices did
   all of that work. This is the key that matters: streaks, retention and the
   per-kind breakdown are computed from it, and it is the one thing here that
   cannot be recreated.
 - **Cards take the server's copy.** They look derivable from the reviews and are
   not: the scheduler fuzzes due dates so a hundred cards learned in one evening
   do not all return in one evening, which means replaying the same reviews on
   two devices lands them a day or two apart with neither wrong. Somebody has to
   be the answer and the server is the one both devices reach.
 - **Everything else takes the server's copy too.** Profiles and settings are
   small, and a learner who changed their daily limit on their phone meant it.

 The asymmetry is the point. Taking the server's copy wholesale would be simpler
 and would lose reviews.
 */
public enum StateMerge {
    /// The engine's key for the review log. Mirrors `STORAGE_KEYS.logs`.
    public static let logsKey = "srs:v1:logs"

    public struct Result: Equatable, Sendable {
        public let values: [String: String]
        /// Reviews this device had that the server did not.
        public let localOnlyReviews: Int
        /// Reviews the server had that this device did not.
        public let remoteOnlyReviews: Int
    }

    /**
     Combine what this device holds with what the server returned.

     Order within the merged log is by `reviewedAt`, because everything computed
     from it reads it in order, and two devices appending independently produce
     two sequences that only interleave correctly once sorted.
     */
    public static func merge(local: [String: String], remote: [String: String]) -> Result {
        /*
         Start from this device, then let the server overwrite.

         Starting from the server's values instead reads as the same thing and is
         not: a key the server has never seen — imported vocabulary, on an
         account that has only ever synced from a phone — would simply vanish.
         The server's copy winning where both sides have a key is the rule; "the
         server has not got it, so delete it" is not.
         */
        var merged = local
        for (key, value) in remote { merged[key] = value }

        let localLogs = parseLogs(local[logsKey])
        let remoteLogs = parseLogs(remote[logsKey])

        if localLogs.isEmpty && remoteLogs.isEmpty {
            return Result(values: merged, localOnlyReviews: 0, remoteOnlyReviews: 0)
        }

        var byId: [String: JSONValue] = [:]
        var order: [String] = []

        for log in remoteLogs {
            guard let id = log.string("id") else { continue }
            if byId[id] == nil { order.append(id) }
            byId[id] = log
        }
        let remoteIds = Set(byId.keys)

        var localOnly = 0
        for log in localLogs {
            guard let id = log.string("id") else { continue }
            if !remoteIds.contains(id) {
                localOnly += 1
                order.append(id)
            }
            // Assigned, not skipped: an id present on both sides describes the
            // same grading, so either copy is correct.
            byId[id] = log
        }

        let localIds = Set(localLogs.compactMap { $0.string("id") })
        let remoteOnly = remoteIds.subtracting(localIds).count

        let ordered = order
            .compactMap { byId[$0] }
            .sorted { ($0.string("reviewedAt") ?? "") < ($1.string("reviewedAt") ?? "") }

        if let encoded = try? JSONEncoder().encode(ordered),
           let text = String(data: encoded, encoding: .utf8) {
            merged[logsKey] = text
        }

        return Result(values: merged, localOnlyReviews: localOnly, remoteOnlyReviews: remoteOnly)
    }

    private static func parseLogs(_ raw: String?) -> [JSONValue] {
        guard let raw, !raw.isEmpty, let data = raw.data(using: .utf8) else { return [] }
        // A corrupt log on either side is treated as empty rather than thrown:
        // the alternative is a sync that can never succeed again, and the other
        // side's copy is probably intact.
        guard case .array(let logs)? = try? JSONDecoder().decode(JSONValue.self, from: data) else {
            return []
        }
        return logs
    }
}

public struct SyncOutcome: Equatable, Sendable {
    public let revision: Int
    public let values: [String: String]
    public let localOnlyReviews: Int
    public let remoteOnlyReviews: Int
}

extension LanguageSrsClient {
    /**
     Push this device's state, merging if the server has moved on.

     The retry is bounded. One conflict is ordinary — another device synced while
     this one was composing its write. A second in the same call means something
     is writing continuously, and spinning would turn a busy account into a hot
     loop against the server.
     */
    public func syncState(
        local: [String: String],
        baseRevision: Int,
        attempts: Int = 3
    ) async throws -> SyncOutcome {
        var values = local
        var revision = baseRevision
        var localOnly = 0
        var remoteOnly = 0

        for _ in 0..<attempts {
            do {
                let response = try await putState(baseRevision: revision, values: values)
                return SyncOutcome(
                    revision: response.revision,
                    values: values,
                    localOnlyReviews: localOnly,
                    remoteOnlyReviews: remoteOnly
                )
            } catch let conflict as StateConflict {
                /*
                 Refetch when the conflict body could not be read, rather than
                 assuming the server is empty and overwriting it.

                 Written out rather than with `??` because the fallback is an
                 async call, and `??` takes an autoclosure that cannot await.
                 */
                let current: AccountState
                if let carried = conflict.current {
                    current = carried
                } else {
                    current = try await getState()
                }
                let merged = StateMerge.merge(local: values, remote: current.values)
                values = merged.values
                revision = current.revision
                localOnly = merged.localOnlyReviews
                remoteOnly = merged.remoteOnlyReviews
            }
        }

        throw StateConflict(current: nil)
    }
}
