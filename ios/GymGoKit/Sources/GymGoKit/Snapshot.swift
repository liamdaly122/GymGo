import Foundation

/// What the phone sends the watch: the session worked out in advance.
///
/// Mirrors `WatchSnapshot` in `src/domain/watch.ts`, field for field. The phone
/// walks the session the way its own screen would and sends every set still to
/// do, in order, with the numbers, rests and "Up next" lines already decided.
/// The watch follows the list and keeps three rules of its own (`Rules.swift`).
public struct WatchSnapshot: Codable, Sendable, Equatable {
    public static let supportedVersion = 1

    public var version: Int
    public var workoutId: String
    public var title: String
    public var startedAt: String
    public var sentAt: String
    public var stations: [WatchStation]
    public var sets: [WatchSet]
    public var lifts: [String: WatchLift]
}

public struct WatchStation: Codable, Sendable, Equatable {
    public var name: String
    public var outline: String
    public var exerciseIds: [String]
}

public struct UpNext: Codable, Sendable, Equatable {
    public var name: String
    public var detail: String
}

public struct SchemeLink: Codable, Sendable, Equatable {
    public var stepsFromTop: Int
    public var topSetId: String
}

public struct WatchSet: Codable, Sendable, Equatable, Identifiable {
    public var id: String
    public var exerciseId: String
    public var workoutExerciseId: String
    public var station: Int
    public var type: String
    public var parentSetId: String?
    public var label: String
    public var weight: Double?
    public var reps: Int?
    public var source: String
    public var carries: Bool
    public var scheme: SchemeLink?
    public var restAfter: Int?
    public var upNext: UpNext

    /// A working set or a continuation can be a record; a warm-up never is.
    public var isTopWorkingSet: Bool { type == "working" && parentSetId == nil }
}

public struct DoneSet: Codable, Sendable, Equatable {
    public var setId: String
    public var weight: Double
    public var reps: Int
    public var completedAt: String?
}

public struct WatchLift: Codable, Sendable, Equatable {
    public var name: String
    public var unit: String
    public var ladder: [Double]
    public var setupNote: String?
    public var priorMarks: RecordMarks?
    public var doneToday: [DoneSet]
    public var loading: LoadingProfile
}

/// What one lift can be loaded with. Mirrors `LoadingProfile` in `src/domain/plates.ts`.
public struct LoadingProfile: Codable, Sendable, Equatable {
    public var mode: String
    public var barWeight: Double?
    public var plates: [Double]?
    public var step: Double?

    public init(mode: String, barWeight: Double? = nil, plates: [Double]? = nil, step: Double? = nil) {
        self.mode = mode
        self.barWeight = barWeight
        self.plates = plates
        self.step = step
    }
}

/// Where a lift's records stand. Mirrors `RecordMarks` in `src/domain/prs.ts`.
public struct RecordMarks: Codable, Sendable, Equatable {
    public var weight: Double
    public var e1rm: Double
    public var unloadedReps: Int

    public init(weight: Double, e1rm: Double, unloadedReps: Int) {
        self.weight = weight
        self.e1rm = e1rm
        self.unloadedReps = unloadedReps
    }
}

extension WatchSnapshot {
    /// Decodes a snapshot, refusing one from a newer phone the watch cannot read.
    public static func decode(_ data: Data) throws -> WatchSnapshot {
        let snapshot = try JSONDecoder().decode(WatchSnapshot.self, from: data)
        guard snapshot.version <= supportedVersion else {
            throw DecodingError.dataCorrupted(.init(codingPath: [], debugDescription: "Snapshot version \(snapshot.version) is newer than this watch app"))
        }
        return snapshot
    }
}
