import Foundation

// WatchEvent lives in Protocol.swift, with the rest of the contract.

/// What logging a set did: whether it was a record, and the rest that follows.
public struct LogOutcome: Sendable, Equatable {
    public var record: SetRecord?
    /// Seconds of rest, or nil when the next set follows straight on.
    public var restSeconds: Int?
    public var upNext: UpNext
    public var event: WatchEvent
    /// The set just logged.
    public var set: WatchSet
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
    public private(set) var discarded = false
    /// Every set logged on the wrist this session, set ID to exercise ID. Kept
    /// after the phone confirms a set, so the counts never go backwards.
    public private(set) var loggedHere: [String: String] = [:]
    /// Records set on the wrist this session.
    public private(set) var records = 0

    public init(snapshot: WatchSnapshot) {
        self.snapshot = snapshot
    }

    enum CodingKeys: String, CodingKey { case snapshot, logged, outbox, finished, discarded, loggedHere, records }

    /// Reads a session saved by any earlier build: fields added since default.
    public init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        snapshot = try container.decode(WatchSnapshot.self, forKey: .snapshot)
        logged = try container.decodeIfPresent([String: LoggedSet].self, forKey: .logged) ?? [:]
        outbox = try container.decodeIfPresent([WatchEvent].self, forKey: .outbox) ?? []
        finished = try container.decodeIfPresent(Bool.self, forKey: .finished) ?? false
        discarded = try container.decodeIfPresent(Bool.self, forKey: .discarded) ?? false
        loggedHere = try container.decodeIfPresent([String: String].self, forKey: .loggedHere) ?? [:]
        records = try container.decodeIfPresent(Int.self, forKey: .records) ?? 0
    }

    /// A planned session started on the wrist. The phone sent it ahead, with
    /// the workout, exercise and set IDs it will write when it replays the
    /// start; the start event goes first, so the phone has the workout before
    /// any set arrives for it. The routine and the layout go back unchanged.
    public static func start(from ready: WatchReady, at date: Date = Date(), eventId: String = UUID().uuidString) -> WatchSession {
        var snapshot = ready.snapshot
        snapshot.startedAt = isoString(date)
        var session = WatchSession(snapshot: snapshot)
        session.outbox = [WatchEvent(
            id: eventId, kind: .startWorkout, workoutId: snapshot.workoutId, at: isoString(date),
            routineId: ready.routineId, layout: ready.layout
        )]
        return session
    }

    // "2026-10-14T17:03:00.000Z", as `toISOString()` writes it on the phone.
    private static let withMillis = Date.ISO8601FormatStyle(includingFractionalSeconds: true)
    private static let withoutMillis = Date.ISO8601FormatStyle()

    public static func isoString(_ date: Date) -> String { date.formatted(withMillis) }
    public static func date(_ string: String?) -> Date {
        guard let string else { return .distantPast }
        return (try? withMillis.parse(string)) ?? (try? withoutMillis.parse(string)) ?? .distantPast
    }

    public var workoutId: String { snapshot.workoutId }
    /// Finished or discarded on the wrist.
    public var isOver: Bool { finished || discarded }

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
        guard !isOver, let set = remainingSets.first, let lift = snapshot.lifts[set.exerciseId] else { return nil }
        let (weight, reps) = numbers(for: set, lift: lift)
        let done = snapshot.sets.count - remainingSets.count
        return SetInHand(
            set: set, lift: lift, weight: weight, reps: reps,
            station: snapshot.stations[set.station],
            position: done + 1, remaining: remainingSets.count
        )
    }

    /// The set IDs done in this workout, on either device.
    private func doneIds(for exerciseIds: Set<String>?) -> Set<String> {
        var ids = Set<String>()
        for (exerciseId, lift) in snapshot.lifts where exerciseIds?.contains(exerciseId) ?? true {
            ids.formUnion(lift.doneToday.map(\.setId))
        }
        for (setId, exerciseId) in loggedHere where exerciseIds?.contains(exerciseId) ?? true {
            ids.insert(setId)
        }
        return ids
    }

    /// Sets done and sets in all, across the session: "Sets 12 of 20".
    public var progress: (done: Int, total: Int) {
        let done = doneIds(for: nil).count
        return (done, done + remainingSets.count)
    }

    /// How far along one station is.
    public func progress(ofStation index: Int) -> (done: Int, total: Int) {
        guard snapshot.stations.indices.contains(index) else { return (0, 0) }
        let done = doneIds(for: Set(snapshot.stations[index].exerciseIds)).count
        let left = remainingSets.filter { $0.station == index }.count
        return (done, done + left)
    }

    /// Whether anything has been logged in this workout, on either device.
    public var hasLoggedASet: Bool {
        !loggedHere.isEmpty
            || outbox.contains { $0.kind == .completeSet }
            || snapshot.lifts.values.contains { !$0.doneToday.isEmpty }
    }

    /// Discard is offered only before the first set is logged: after that
    /// there is work to keep, and Finish is the way out.
    public var canDiscard: Bool { !isOver && !hasLoggedASet }

    /// The phone's numbers, unless one of the watch's rules now knows better.
    func numbers(for set: WatchSet, lift: WatchLift) -> (Double?, Int?) {
        // Rule 2: a back-off set aims off today's top set, once it is logged.
        if let scheme = set.scheme, let top = history(of: set.exerciseId).first(where: { $0.setId == scheme.topSetId }) {
            let target = schemeTarget(top: (top.weight, top.reps), steps: scheme.stepsFromTop, loading: lift.loading, ladder: lift.ladder)
            // A number typed on the phone beats the target, field by field,
            // as it beats every placeholder there (`startingNumbers` in
            // src/domain/setHints.ts). The list says which only when nothing
            // in the set came from a placeholder: `source` "typed", where a
            // typed field is above zero and an untyped one has nothing.
            guard set.source == "typed" else { return (target.weight, target.reps) }
            let weight = set.weight.flatMap { $0 > 0 ? $0 : nil } ?? target.weight
            let reps = set.reps.flatMap { $0 > 0 ? $0 : nil } ?? target.reps
            return (weight, reps)
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
        loggedHere[set.id] = set.exerciseId
        if record != nil { records += 1 }
        let event = WatchEvent(id: eventId, kind: .completeSet, workoutId: snapshot.workoutId, setId: set.id, weight: weight, reps: reps, at: Self.isoString(date))
        outbox.append(event)
        return LogOutcome(record: record, restSeconds: set.restAfter, upNext: set.upNext, event: event, set: set)
    }

    @discardableResult
    public mutating func skipRest(at date: Date = Date(), eventId: String = UUID().uuidString) -> WatchEvent {
        let event = WatchEvent(id: eventId, kind: .skipRest, workoutId: snapshot.workoutId, at: Self.isoString(date))
        outbox.append(event)
        return event
    }

    /// Finish and save. The event carries every set logged on the wrist that
    /// the phone has not confirmed, in the order they were logged, so a Finish
    /// that overtakes its last sets cannot tidy them away.
    @discardableResult
    public mutating func finish(at date: Date = Date(), eventId: String = UUID().uuidString) -> WatchEvent? {
        guard !isOver else { return nil }
        finished = true
        let sets = outbox.filter { $0.kind == .completeSet && $0.workoutId == snapshot.workoutId }
        let event = WatchEvent(id: eventId, kind: .finish, workoutId: snapshot.workoutId, at: Self.isoString(date), sets: sets)
        outbox.append(event)
        return event
    }

    /// Throws the workout away. Only before the first set is logged.
    @discardableResult
    public mutating func discard(at date: Date = Date(), eventId: String = UUID().uuidString) -> WatchEvent? {
        guard canDiscard else { return nil }
        discarded = true
        let event = WatchEvent(id: eventId, kind: .discard, workoutId: snapshot.workoutId, at: Self.isoString(date))
        outbox.append(event)
        return event
    }

    /// The phone has applied these events.
    public mutating func acknowledge(_ eventIds: Set<String>) {
        outbox.removeAll { eventIds.contains($0.id) }
    }

    public enum Received: Equatable, Sendable {
        /// The same workout, a newer list.
        case updated
        /// A different workout took the session's place.
        case replaced
        /// Older than what the wrist has, or a different workout while the
        /// wrist still has events the phone has not confirmed.
        case ignored
    }

    /// A newer list from the phone. A set the phone now shows as done is no
    /// longer the wrist's to remember; anything the phone has not yet applied
    /// stays logged, so it is not offered again. A list for a different
    /// workout replaces the session only when nothing here is still waiting
    /// for the phone: replacing it then would throw those events away.
    @discardableResult
    public mutating func receive(_ newer: WatchSnapshot) -> Received {
        guard newer.workoutId == snapshot.workoutId else {
            guard outbox.isEmpty else { return .ignored }
            self = WatchSession(snapshot: newer)
            return .replaced
        }
        guard Self.date(newer.sentAt) >= Self.date(snapshot.sentAt) else { return .ignored }
        let doneOnPhone = Set(newer.lifts.values.flatMap { $0.doneToday.map(\.setId) })
        logged = logged.filter { !doneOnPhone.contains($0.key) }
        snapshot = newer
        return .updated
    }
}
