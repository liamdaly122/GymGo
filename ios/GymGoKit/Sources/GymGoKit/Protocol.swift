import Foundation

// The contract between the phone and the watch, mirroring
// src/domain/watchProtocol.ts field for field. The rules for when each
// message is sent and how it is applied are in docs/watch-protocol.md.

public let watchProtocolVersion = 1

// MARK: - Phone → watch: the application context, JSON under "context"

public struct WatchContext: Codable, Sendable, Equatable {
    public var v: Int
    /// Phone clock, ISO. Newer contexts replace older ones.
    public var sentAt: String
    /// The workout open on the phone. Nil when none is open.
    public var live: WatchSnapshot?
    public var home: WatchHome
    public var phoneClaim: PhoneClaim?
    public var settings: WatchSettings

    public static func decode(_ data: Data) throws -> WatchContext {
        let context = try JSONDecoder().decode(WatchContext.self, from: data)
        guard context.v <= watchProtocolVersion else {
            throw DecodingError.dataCorrupted(.init(codingPath: [], debugDescription: "Context version \(context.v) is newer than this watch app"))
        }
        return context
    }
}

public struct PhoneClaim: Codable, Sendable, Equatable {
    public var workoutId: String
    public var at: String
}

public struct WatchSettings: Codable, Sendable, Equatable {
    public var sound: Bool
    public var vibrate: Bool
}

public struct WatchHome: Codable, Sendable, Equatable {
    public enum State: String, Codable, Sendable { case ready, running, blockDone, noPlan }

    public var today: String
    public var state: State
    public var doneToday: [DoneWorkout]
    public var closed: [ClosedWorkout]
    public var ready: WatchReady?
    public var week: [WatchWeekDay]
}

public struct DoneWorkout: Codable, Sendable, Equatable {
    public var workoutId: String
    public var name: String
}

public struct ClosedWorkout: Codable, Sendable, Equatable {
    public enum How: String, Codable, Sendable { case finished, discarded }
    public var workoutId: String
    public var how: How
    public var at: String
}

public struct WatchReady: Codable, Sendable, Equatable {
    public struct Week: Codable, Sendable, Equatable {
        public var week: Int
        public var totalWeeks: Int
        public var label: String
    }

    public struct Line: Codable, Sendable, Equatable {
        public var name: String
        public var kit: String?
        public var work: String
        public var badge: String?
        public var superset: String?
    }

    public enum Status: String, Codable, Sendable { case today, upcoming }

    public var key: String
    public var routineId: String
    public var name: String
    public var date: String
    public var status: Status
    public var movedFrom: String?
    public var week: Week?
    public var minutes: Int
    public var exercises: [Line]
    /// The phone's `StartLayout`, as JSON: echoed back in the startWorkout
    /// event, unchanged, except after a Discard on the wrist. The same
    /// session then starts again under IDs the watch mints (lowercase v4
    /// UUIDs), because the phone writes a workout ID once. Exactly three
    /// fields are re-minted, alike in the layout and the snapshot:
    /// `workoutId`, `exercises[].id` and `exercises[].sets[].id`
    /// (`withFreshIds`, FreshIds.swift). An ID field added to the layout must
    /// be added to `LayoutIds` there too, or a start again would point at the
    /// discarded workout's rows.
    public var layout: String
    public var snapshot: WatchSnapshot
}

public struct WatchWeekDay: Codable, Sendable, Equatable {
    public enum State: String, Codable, Sendable { case done, planned, today, rest }
    public var date: String
    public var weekday: String
    public var state: State
    public var name: String?
}

// MARK: - Watch → phone: events

/// What the watch tells the phone. Each carries its own ID, so a copy that
/// arrives twice is applied once. Times are ISO 8601 in UTC.
public struct WatchEvent: Codable, Sendable, Equatable, Identifiable {
    public enum Kind: String, Codable, Sendable { case completeSet, skipRest, finish, discard, startWorkout }

    public var id: String
    public var kind: Kind
    public var workoutId: String
    public var setId: String?
    public var weight: Double?
    public var reps: Int?
    public var at: String
    /// startWorkout: the ready session's routine and its layout, echoed back
    /// (re-minted after a Discard on the wrist: see `WatchReady.layout`).
    public var routineId: String?
    public var layout: String?
    /// finish: the unconfirmed completeSet events for this workout, in order.
    public var sets: [WatchEvent]?

    public init(
        id: String, kind: Kind, workoutId: String, setId: String? = nil, weight: Double? = nil,
        reps: Int? = nil, at: String, routineId: String? = nil, layout: String? = nil, sets: [WatchEvent]? = nil
    ) {
        self.id = id
        self.kind = kind
        self.workoutId = workoutId
        self.setId = setId
        self.weight = weight
        self.reps = reps
        self.at = at
        self.routineId = routineId
        self.layout = layout
        self.sets = sets
    }
}

// MARK: - Watch → phone: state

public struct WatchStateReport: Codable, Sendable, Equatable {
    public enum Session: String, Codable, Sendable { case running, ended, none }
    public enum Owner: String, Codable, Sendable { case watch, phone }
    public enum Health: String, Codable, Sendable { case recording, unavailable, denied, off }

    public struct Rest: Codable, Sendable, Equatable {
        public var endsAt: String
        public var upNext: UpNext
        public init(endsAt: String, upNext: UpNext) {
            self.endsAt = endsAt
            self.upNext = upNext
        }
    }

    public var v: Int
    public var at: String
    public var seq: Int
    public var workoutId: String?
    public var session: Session
    public var owner: Owner
    public var seenPhoneClaim: String?
    public var setId: String?
    public var rest: Rest?
    public var heartRate: Double?
    public var activeKcal: Double?
    public var health: Health

    public init(
        v: Int = watchProtocolVersion, at: String, seq: Int, workoutId: String?, session: Session, owner: Owner,
        seenPhoneClaim: String?, setId: String?, rest: Rest?, heartRate: Double?, activeKcal: Double?, health: Health
    ) {
        self.v = v
        self.at = at
        self.seq = seq
        self.workoutId = workoutId
        self.session = session
        self.owner = owner
        self.seenPhoneClaim = seenPhoneClaim
        self.setId = setId
        self.rest = rest
        self.heartRate = heartRate
        self.activeKcal = activeKcal
        self.health = health
    }
}
