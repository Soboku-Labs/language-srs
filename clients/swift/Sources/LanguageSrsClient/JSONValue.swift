import Foundation

/**
 Any JSON value, decoded without being understood.

 Swift's `Codable` has no equivalent of Kotlin's `JsonElement`, and two places
 here need one: the word-list entries this client passes straight through to the
 engine, and the review logs the merge reorders without interpreting. Both are
 data whose shape belongs to `packages/core`, and redeclaring it here would be a
 second definition to keep in step for no benefit.

 Deliberately small. This is not a JSON library — it decodes, re-encodes
 unchanged, and lets a caller read a string field by name. Anything more would be
 the beginning of one.
 */
public enum JSONValue: Codable, Equatable, Sendable {
    case null
    case bool(Bool)
    case number(Double)
    case string(String)
    case array([JSONValue])
    case object([String: JSONValue])

    public init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()

        if container.decodeNil() {
            self = .null
        } else if let value = try? container.decode(Bool.self) {
            self = .bool(value)
        } else if let value = try? container.decode(Double.self) {
            self = .number(value)
        } else if let value = try? container.decode(String.self) {
            self = .string(value)
        } else if let value = try? container.decode([JSONValue].self) {
            self = .array(value)
        } else if let value = try? container.decode([String: JSONValue].self) {
            self = .object(value)
        } else {
            throw DecodingError.dataCorruptedError(
                in: container,
                debugDescription: "Not a JSON value."
            )
        }
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()

        switch self {
        case .null: try container.encodeNil()
        case .bool(let value): try container.encode(value)
        case .number(let value):
            /*
             Whole numbers are re-encoded as integers.

             Everything arrives as `Double` because JSON has one number type, and
             re-encoding it as one turns a rating of `3` into `3.0`. The server
             parses that back to 3 happily, but it also means a round-tripped
             review log is not byte-identical to the one that was stored, which
             makes diffs during debugging a great deal harder to read.
             */
            if value == value.rounded(), abs(value) < 9_007_199_254_740_992 {
                try container.encode(Int(value))
            } else {
                try container.encode(value)
            }
        case .string(let value): try container.encode(value)
        case .array(let value): try container.encode(value)
        case .object(let value): try container.encode(value)
        }
    }

    /// The string at `key`, when this is an object and that field is a string.
    public func string(_ key: String) -> String? {
        guard case .object(let fields) = self, case .string(let value)? = fields[key] else {
            return nil
        }
        return value
    }
}
