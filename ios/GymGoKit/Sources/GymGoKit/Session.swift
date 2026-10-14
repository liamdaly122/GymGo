import Foundation

/// What the watch tells the phone. Each event carries its own ID, so a copy
/// that arrives twice (once by `sendMessage`, once by `transferUserInfo`) is
/// applied once. Times are ISO 8601 in UTC, as everywhere else in GymGo.
public struct WatchEvent: Codable, Sendable, Equatable, Identifiable {
    public enum Kind: String, Codable, Sendable { case completeSet, skipRest, finish }

    public var id: String
    public var kind: Kind
    public var workoutId: String
    public var setId: String?
    public var weight: Double?
    public var reps: Int?
    public var at: String
}

/// What logging a set did: whether it was a record, and the rest that follows.
public struct LogOutcome: Sendable, Equatable {
    public var record: SetRecord?
    /// Seconds of rest, or nil when the next set follows straight on.
    public var restSeconds: Int?
    public var upNext: UpNext
    public var event: WatchEvent
}

/// The set in hand, with the numbers to start at once the watch's own rules
/// have had their say.
public struct SetInHand: Sendable, Equatable {
    public var set: WatchSet
    public var lift: WatchLift
    public var weight: Double?
    public var reps: Int?
    public var station: WatchStation
    /// "Set 2 of 4" counts within the lift; this counts the session.
    public var position: Int
    public var remaining: Int
}

/// A session as the watch runs it: the phone's list, and what has been logged
/// on the wrist since. Codable, so a crash or a relaunch mid-session keeps
/// its place. A value type: every change returns through `mutating`.
public struct WatchSession: Codable, Sendable, Equatable {
    public private(set) var snapshot: WatchSnapshot
    /// Sets logged on the wrist that the phone has not yet confirmed, by set ID.
    public private(set) var logged: [String: LoggedSet] = [:]
    /// Events not yet confirmed by the phone, oldest first.
    public private(set) var outbox: [WatchEvent] = []
    public private(set) var finished = false

    public init(snapshot: WatchSnapshot) {
        self.snapshot = snapshot
    }

    // "2026-10-14T17:03:00.000Z", as `toISOString()` writes it on the phone.
    private static let withMillis = Date.ISO8601FormatStyle(includingFractionalSeconds: true)
    private static let withoutMillis = Date.ISO8601FormatStyle()

    static func isoString(_ date: Date) -> String { date.formatted(withMillis) }
    static func date(_ string: String?) -> Date {
        guard let string else { return .distantPast }
        return (try? withMillis.parse(string)) ?? (try? withoutMillis.parse(string)) ?? .distantPast
    }

    /// Everything logged today for one lift: what the phone already had, and
    /// what the wrist has added since.
    func history(of exerciseId: String) -> [LoggedSet] {
        let lift = snapshot.lifts[exerciseId]
        let fromPhone = (lift?.doneToday ?? []).map {
            LoggedSet(setId: $0.setId, type: "working", isChild: false, weight: $0.weight, reps: $0.reps, completedAt: Self.date($0.completedAt))
        }
        let phoneIds = Set(fromPhone.map(\.setId))
        let fromWrist = snapshot.sets
            .filter { $0.exerciseId == exerciseId }
            .compactMap { logged[$0.id] }
            .filter { !phoneIds.contains($0.setId) }
        return (fromPhone + fromWrist).sorted { $0.completedAt < $1.completedAt }
    }

    /// The sets still to do, in order.
    public var remainingSets: [WatchSet] { snapshot.sets.filter { logged[$0.id] == nil } }

    public var setInHand: SetInHand? {
        guard !finished, let set = remainingSets.first, let lift = snapshot.lifts[set.exerciseId] else { return nil }
        let (weight, reps) = numbers(for: set, lift: lift)
        let done = snapshot.sets.count - remainingSets.count
        return SetInHand(
            set: set, lift: lift, weight: weight, reps: reps,
            station: snapshot.stations[set.station],
            position: done + 1, remaining: remainingSets.count
        )
    }

    /// The phone's numbers, unless one of the watch's rules now knows better.
    func numbers(for set: WatchSet, lift: WatchLift) -> (Double?, Int?) {
        // Rule 2: a back-off set aims off today's top set, once it is logged.
        if let scheme = set.scheme, let top = history(of: set.exerciseId).first(where: { $0.setId == scheme.topSetId }) {
            let target = schemeTarget(top: (top.weight, top.reps), steps: scheme.stepsFromTop, loading: lift.loading, ladder: lift.ladder)
            return (target.weight, target.reps)
        }
        // Rule 1: from the second set on, start at the set just done.
        if set.carries, let carried = carriedSet(history(of: set.exerciseId)) {
            return (carried.weight, carried.reps)
        }
        return (set.weight, set.reps)
    }

    /// Logs the set in hand. Returns nil when there is nothing left to log.
    public mutating func logSetInHand(weight: Double, reps: Int, at date: Date = Date(), eventId: String = UUID().uuidString) -> LogOutcome? {
        guard let hand = setInHand else { return nil }
        let set = hand.set
        let entry = LoggedSet(setId: set.id, type: set.type, isChild: set.parentSetId != nil, weight: weight, reps: reps, completedAt: date)
        // Rule 3: judged before it is added, against history and today's earlier sets.
        let record = setBreaksRecord(entry, prior: hand.lift.priorMarks, earlier: history(of: set.exerciseId))
        logged[set.id] = entry
        let event = WatchEvent(id: eventId, kind: .completeSet, workoutId: snapshot.workoutId, setId: set.id, weight: weight, reps: reps, at: Self.isoString(date))
        outbox.append(event)
        return LogOutcome(record: record, restSeconds: set.restAfter, upNext: set.upNext, event: event)
    }

    public mutating func skipRest(at date: Date = Date(), eventId: String = UUID().uuidString) {
        outbox.append(WatchEvent(id: eventId, kind: .skipRest, workoutId: snapshot.workoutId, setId: nil, weight: nil, reps: nil, at: Self.isoString(date)))
    }

    public mutating func finish(at date: Date = Date(), eventId: String = UUID().uuidString) {
        finished = true
        outbox.append(WatchEvent(id: eventId, kind: .finish, workoutId: snapshot.workoutId, setId: nil, weight: nil, reps: nil, at: Self.isoString(date)))
    }

    /// The phone has applied these events.
    public mutating func acknowledge(_ eventIds: Set<String>) {
        outbox.removeAll { eventIds.contains($0.id) }
    }

    /// A newer list from the phone. A set the phone now shows as done is no
    /// longer the wrist's to remember; anything the phone has not yet applied
    /// stays logged, so it is not offered again.
    public mutating func receive(_ newer: WatchSnapshot) {
        guard newer.workoutId == snapshot.workoutId else {
            self = WatchSession(snapshot: newer)
            return
        }
        guard newer.sentAt >= snapshot.sentAt else { return }
        let doneOnPhone = Set(newer.lifts.values.flatMap { $0.doneToday.map(\.setId) })
        logged = logged.filter { !doneOnPhone.contains($0.key) }
        snapshot = newer
    }
}
