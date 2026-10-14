import Foundation

/// What the phone sends the watch: the session worked out in advance.
///
/// Mirrors `WatchSnapshot` in `src/domain/watch.ts`, field for field. The phone
/// walks the session the way its own screen would and sends every set still to
/// do, in order, with the numbers, rests and "Up next" lines already decided.
/// The watch follows the list and keeps a few rules of its own (`Rules.swift`).
///
/// A field added since build 6 is Optional, here and in everything saved in
/// `watch-state.json`: a synthesised decoder throws on a missing non-Optional
/// key, and a failed restore loses the sets the phone has not confirmed. A
/// missing Optional decodes to nil, so readers treat nil as false or empty.
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
    /// Marked AMRAP on the phone. Sent only when true; nil is false. Rule 1
    /// never steps down off an AMRAP set.
    public var amrap: Bool?

    /// A working set or a continuation can be a record; a warm-up never is.
    public var isTopWorkingSet: Bool { type == "working" && parentSetId == nil }
}

public struct DoneSet: Codable, Sendable, Equatable {
    public var setId: String
    public var weight: Double
    public var reps: Int
    public var completedAt: String?
    /// Sent only when true; nil is false.
    public var amrap: Bool?
}

public struct WatchLift: Codable, Sendable, Equatable {
    public var name: String
    public var unit: String
    public var ladder: [Double]
    public var setupNote: String?
    public var priorMarks: RecordMarks?
    public var doneToday: [DoneSet]
    public var loading: LoadingProfile
    /// Why the first set's numbers are what they are. Nil with no suggestion,
    /// and from a build 6 phone.
    public var plan: LiftPlan?
    /// The last session of this lift. Nil for a first, and from a build 6 phone.
    public var lastTime: LastTime?
    /// Rule 1: the bottom of the rep range, which a set that fell short steps
    /// down to. Nil for freestyle, and from a build 6 phone.
    public var repLow: Int?
}

/// The engine's plan for a lift. Mirrors `WatchPlan` in `src/domain/watch.ts`.
public struct LiftPlan: Codable, Sendable, Equatable {
    /// `add_weight`, `add_reps`, `repeat`, `deload` or `estimate`. A String, so
    /// a kind a newer phone adds still decodes.
    public var kind: String
    /// The phone's own word for it ("Go up", "More reps", "Hold", "Back off",
    /// "Estimate"). The watch shows this, never a wording of its own.
    public var verb: String
    /// Plain English, at most 320 characters.
    public var reason: String

    public init(kind: String, verb: String, reason: String) {
        self.kind = kind
        self.verb = verb
        self.reason = reason
    }
}

/// The last session of a lift. Mirrors `WatchLastTime` in `src/domain/watch.ts`.
public struct LastTime: Codable, Sendable, Equatable {
    /// The lifter's calendar day it was finished, "2026-10-03". `dayLabel`
    /// words it: the phone sends no relative words, since the watch may be
    /// days past the phone's last context.
    public var day: String
    /// The best working set, as the phone's previous-performance line. The
    /// watch never re-derives that rule.
    public var top: SetNumbers
    /// Every working set, in the order done.
    public var sets: [SetNumbers]

    public init(day: String, top: SetNumbers, sets: [SetNumbers]) {
        self.day = day
        self.top = top
        self.sets = sets
    }
}

/// A weight and reps, as done.
public struct SetNumbers: Codable, Sendable, Equatable {
    public var weight: Double
    public var reps: Int

    public init(weight: Double, reps: Int) {
        self.weight = weight
        self.reps = reps
    }
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
