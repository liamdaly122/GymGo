import Foundation

// The JSON strings that cross the link. Swift's synthesised encoder leaves a
// nil optional out altogether, but the TypeScript side of the contract
// (src/domain/watchProtocol.ts) types the state report's fields as `T | null`,
// never as optional, so the report is written with every key present and an
// explicit null where there is nothing. Events may leave keys out: their
// optional fields are optional on both sides.

public enum WireError: Error { case notUTF8 }

extension WatchEvent {
    public func json() throws -> String {
        try utf8(JSONEncoder().encode(self))
    }

    public static func decode(_ json: String) throws -> WatchEvent {
        try JSONDecoder().decode(WatchEvent.self, from: Data(json.utf8))
    }
}

extension WatchStateReport {
    /// Every nullable key, written even when it is null.
    static let nullableKeys = ["workoutId", "seenPhoneClaim", "setId", "inHand", "rest", "paused", "heartRate", "activeKcal"]

    public func json() throws -> String {
        let data = try JSONEncoder().encode(self)
        guard var object = try JSONSerialization.jsonObject(with: data) as? [String: Any] else { return try utf8(data) }
        for key in Self.nullableKeys where object[key] == nil { object[key] = NSNull() }
        return try utf8(JSONSerialization.data(withJSONObject: object, options: [.sortedKeys]))
    }
}

extension WatchContext {
    public static func decode(_ json: String) throws -> WatchContext {
        try decode(Data(json.utf8))
    }
}

private func utf8(_ data: Data) throws -> String {
    guard let string = String(data: data, encoding: .utf8) else { throw WireError.notUTF8 }
    return string
}
