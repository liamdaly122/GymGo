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

/// The numbers a set starts at, and where they came from.
public struct StartingNumbers: Sendable, Equatable {
    public var weight: Double?
    public var reps: Int?
    /// In the list's words (`WatchSet.source`): the list's own source while
    /// neither of the watch's rules replaced its numbers, else `scheme`
    /// (rule 2), `carried` or `stepped` (rule 1).
    public var source: String
    /// Why a `stepped` set is lighter than the set just done.
    public var stepped: StepDown?
}

/// The set in hand, with the numbers to start at once the watch's own rules
/// have had their say.
public struct SetInHand: Sendable, Equatable {
    public var set: WatchSet
    public var lift: WatchLift
    public var weight: Double?
    public var reps: Int?
    /// Where `weight` and `reps` came from (`StartingNumbers.source`).
    public var source: String
    public var stepped: StepDown?
    public var station: WatchStation
    /// "Set 2 of 4" counts within the lift; this counts the session.
    public var position: Int
    public var remaining: Int
    /// Nothing of this lift is done today yet, on either device: the rest
    /// before it may say how it went last time.
    public var firstOfLiftToday: Bool
}

/// How far along one station is.
public struct StationProgress: Sendable, Equatable {
    public var done: Int
    /// Neither done nor skipped.
    public var left: Int
    /// Skipped on the wrist: neither done nor left.
    public var skipped: Int
    public var total: Int { done + left + skipped }
    /// Nothing left to do, and nothing skipped to come back to.
    public var finished: Bool { total > 0 && left == 0 && skipped == 0 }
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
    /// The station chosen on the wrist, by its first member's
    /// `workoutExerciseId`: a station's index shifts when the phone reorders
    /// the session, this does not. Nil follows the list.
    public private(set) var focus: String?
    /// Set IDs skipped on the wrist ("Skip this set", "Done with this lift"):
    /// neither done nor left to do. The state report carries them.
    public private(set) var skipped: [String] = []

    public init(snapshot: WatchSnapshot) {
        self.snapshot = snapshot
    }

    enum CodingKeys: String, CodingKey { case snapshot, logged, outbox, finished, discarded, loggedHere, records, focus, skipped }

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
        focus = try container.decodeIfPresent(String.self, forKey: .focus)
        skipped = try container.decodeIfPresent([String].self, forKey: .skipped) ?? []
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
            LoggedSet(
                setId: $0.setId, type: "working", isChild: false, weight: $0.weight, reps: $0.reps,
                completedAt: Self.date($0.completedAt), isAmrap: $0.amrap
            )
        }
        let phoneIds = Set(fromPhone.map(\.setId))
        let fromWrist = snapshot.sets
            .filter { $0.exerciseId == exerciseId }
            .compactMap { logged[$0.id] }
            .filter { !phoneIds.contains($0.setId) }
        return (fromPhone + fromWrist).sorted { $0.completedAt < $1.completedAt }
    }

    /// The sets still to do, in order: neither logged nor skipped.
    public var remainingSets: [WatchSet] {
        let skipped = Set(self.skipped)
        return snapshot.sets.filter { logged[$0.id] == nil && !skipped.contains($0.id) }
    }

    /// Sets skipped on the wrist and not done since: neither done nor left to do.
    public var skippedSets: [WatchSet] {
        let skipped = Set(self.skipped)
        return snapshot.sets.filter { skipped.contains($0.id) && logged[$0.id] == nil }
    }

    // MARK: - Where the wrist is (rules 4 and 5)

    /// The station any of a workout exercise's sets on the list is at.
    private func station(ofWorkoutExercise key: String) -> Int? {
        snapshot.sets.first { $0.workoutExerciseId == key }?.station
    }

    /// What a station is focused by: its first member's `workoutExerciseId`,
    /// or another member's while the first has nothing on the list. Nil for a
    /// station with nothing on the list.
    private func focusKey(ofStation index: Int) -> String? {
        guard snapshot.stations.indices.contains(index) else { return nil }
        let onList = snapshot.sets.filter { $0.station == index }
        let first = snapshot.stations[index].exerciseIds.first
        return (onList.first { $0.exerciseId == first } ?? onList.first)?.workoutExerciseId
    }

    /// The station chosen on the wrist, by index. Nil with no focus.
    public var focusedStation: Int? { focus.flatMap(station(ofWorkoutExercise:)) }

    /// Which stations have work left.
    private func open(_ remaining: [WatchSet]) -> [Bool] {
        var open = Array(repeating: false, count: snapshot.stations.count)
        for set in remaining where open.indices.contains(set.station) { open[set.station] = true }
        return open
    }

    /// The set the wrist does next: the focused station's first set left, in
    /// list order (which already puts warm-ups first, superset rounds in turn
    /// and children after their parent); else the first of the station
    /// `nextStation` picks from there; with no focus, the first set left.
    private var nextSet: WatchSet? {
        let remaining = remainingSets
        guard let focused = focusedStation else { return remaining.first }
        if let set = remaining.first(where: { $0.station == focused }) { return set }
        guard let next = nextStation(open(remaining), from: focused) else { return nil }
        return remaining.first { $0.station == next }
    }

    public var setInHand: SetInHand? {
        guard !isOver, let set = nextSet, let lift = snapshot.lifts[set.exerciseId],
              snapshot.stations.indices.contains(set.station) else { return nil }
        let numbers = numbers(for: set, lift: lift)
        let loggedOnList = snapshot.sets.filter { logged[$0.id] != nil }.count
        return SetInHand(
            set: set, lift: lift, weight: numbers.weight, reps: numbers.reps, source: numbers.source, stepped: numbers.stepped,
            station: snapshot.stations[set.station],
            position: loggedOnList + 1, remaining: remainingSets.count,
            firstOfLiftToday: history(of: set.exerciseId).isEmpty
        )
    }

    /// What the rest says is next (`upNextFor`, rule 5): the set in hand,
    /// worded from the station of `exerciseId`, the lift the rest followed.
    public func upNext(afterLift exerciseId: String?) -> UpNext {
        guard let next = setInHand else { return watchFinish }
        let station = next.set.station
        let same = exerciseId.map { snapshot.stations[station].exerciseIds.contains($0) } ?? false
        return upNextFor(
            fromStation: same ? station : -1,
            next: UpNextSet(station: station, name: next.lift.name, label: next.set.label, weight: next.weight, reps: next.reps),
            stations: snapshot.stations
        )
    }

    /// "Skip this set": the set in hand, and anything hanging off it. The
    /// IDs skipped, or nil with nothing in hand.
    @discardableResult
    public mutating func skipSetInHand() -> [String]? {
        guard !isOver, let set = nextSet else { return nil }
        return skip([set.id] + remainingSets.filter { $0.parentSetId == set.id }.map(\.id), at: set.station)
    }

    /// "Done with this lift": every set left at the station in hand, a
    /// superset's partner with it. The IDs skipped, or nil with nothing in hand.
    @discardableResult
    public mutating func skipStationInHand() -> [String]? {
        guard !isOver, let set = nextSet else { return nil }
        return skip(remainingSets.filter { $0.station == set.station }.map(\.id), at: set.station)
    }

    private mutating func skip(_ ids: [String], at station: Int) -> [String] {
        for id in ids where !skipped.contains(id) { skipped.append(id) }
        focus = focusKey(ofStation: station) ?? focus
        return ids
    }

    /// The set after this one on the list.
    func set(after set: WatchSet) -> WatchSet? {
        guard let index = snapshot.sets.firstIndex(where: { $0.id == set.id }), index + 1 < snapshot.sets.count else { return nil }
        return snapshot.sets[index + 1]
    }

    /// A station tapped on This session: the set in hand moves there. A
    /// station whose only sets left are skipped gets them back. False for a
    /// station with nothing left to do.
    @discardableResult
    public mutating func go(toStation index: Int) -> Bool {
        guard !isOver, let key = focusKey(ofStation: index) else { return false }
        if !remainingSets.contains(where: { $0.station == index }) {
            let back = Set(skippedSets.filter { $0.station == index }.map(\.id))
            guard !back.isEmpty else { return false }
            skipped.removeAll { back.contains($0) }
        }
        focus = key
        return true
    }

    /// The rest a set takes when it has none only because the sets after it
    /// in its round were skipped: the first rest among them. A superset's
    /// first half skipped past its partner rests as the partner would have.
    func restHandedOn(after set: WatchSet) -> Int? {
        guard set.restAfter == nil, let index = snapshot.sets.firstIndex(where: { $0.id == set.id }) else { return nil }
        let skipped = Set(self.skipped)
        for later in snapshot.sets[(index + 1)...] {
            guard later.station == set.station, skipped.contains(later.id), logged[later.id] == nil else { return nil }
            if let rest = later.restAfter { return rest }
        }
        return nil
    }

    /// The set logged most recently on the wrist that the phone has not yet
    /// confirmed, if it is still on the list.
    var lastLoggedSet: WatchSet? {
        guard let latest = logged.values.max(by: { $0.completedAt < $1.completedAt }) else { return nil }
        return snapshot.sets.first { $0.id == latest.setId }
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

    /// Sets done and sets in all, across the session: "Sets 12 of 20". A
    /// skipped set is in all, and neither done nor left.
    public var progress: (done: Int, total: Int) {
        let done = doneIds(for: nil).count
        return (done, done + remainingSets.count + skippedSets.count)
    }

    /// How far along one station is. A skipped set is in `total`, and neither
    /// done nor left.
    public func stationProgress(_ index: Int) -> StationProgress {
        guard snapshot.stations.indices.contains(index) else { return StationProgress(done: 0, left: 0, skipped: 0) }
        return StationProgress(
            done: doneIds(for: Set(snapshot.stations[index].exerciseIds)).count,
            left: remainingSets.filter { $0.station == index }.count,
            skipped: skippedSets.filter { $0.station == index }.count
        )
    }

    /// How far along one station is.
    public func progress(ofStation index: Int) -> (done: Int, total: Int) {
        let progress = stationProgress(index)
        return (progress.done, progress.total)
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

    /// The phone's numbers, unless one of the watch's rules now knows better,
    /// and which won.
    func numbers(for set: WatchSet, lift: WatchLift) -> StartingNumbers {
        // Rule 2: a back-off set aims off today's top set, once it is logged.
        if let scheme = set.scheme, let top = history(of: set.exerciseId).first(where: { $0.setId == scheme.topSetId }) {
            let target = schemeTarget(top: (top.weight, top.reps), steps: scheme.stepsFromTop, loading: lift.loading, ladder: lift.ladder)
            // A number typed on the phone beats the target, field by field,
            // as it beats every placeholder there (`startingNumbers` in
            // src/domain/setHints.ts). The list says which only when nothing
            // in the set came from a placeholder: `source` "typed", where a
            // typed field is above zero and an untyped one has nothing.
            guard set.source == "typed" else { return StartingNumbers(weight: target.weight, reps: target.reps, source: "scheme") }
            let weight = set.weight.flatMap { $0 > 0 ? $0 : nil } ?? target.weight
            let reps = set.reps.flatMap { $0 > 0 ? $0 : nil } ?? target.reps
            return StartingNumbers(weight: weight, reps: reps, source: "typed")
        }
        // Rule 1: from the second set on, start at the set just done, a notch
        // lighter when it fell short of the range.
        if set.carries,
           let carried = carriedSet(history(of: set.exerciseId), repLow: lift.repLow, loading: lift.loading, ladder: lift.ladder) {
            return StartingNumbers(
                weight: carried.weight, reps: carried.reps,
                source: carried.stepped == nil ? "carried" : "stepped", stepped: carried.stepped
            )
        }
        return StartingNumbers(weight: set.weight, reps: set.reps, source: set.source)
    }

    /// Logs the set in hand. Returns nil when there is nothing left to log.
    public mutating func logSetInHand(weight: Double, reps: Int, at date: Date = Date(), eventId: String = UUID().uuidString) -> LogOutcome? {
        guard let hand = setInHand else { return nil }
        let set = hand.set
        let entry = LoggedSet(
            setId: set.id, type: set.type, isChild: set.parentSetId != nil, weight: weight, reps: reps,
            completedAt: date, isAmrap: set.amrap == true ? true : nil
        )
        // Rule 3: judged before it is added, against history and today's earlier sets.
        let record = setBreaksRecord(entry, prior: hand.lift.priorMarks, earlier: history(of: set.exerciseId))
        logged[set.id] = entry
        loggedHere[set.id] = set.exerciseId
        if record != nil { records += 1 }
        // Logging a set focuses its station.
        focus = focusKey(ofStation: set.station) ?? focus
        let event = WatchEvent(id: eventId, kind: .completeSet, workoutId: snapshot.workoutId, setId: set.id, weight: weight, reps: reps, at: Self.isoString(date))
        outbox.append(event)
        return LogOutcome(
            record: record, restSeconds: set.restAfter ?? restHandedOn(after: set),
            upNext: upNext(afterLift: set.exerciseId), event: event, set: set
        )
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
    /// stays logged, so it is not offered again. The wrist keeps its focus and
    /// what it skipped, less anything the phone has done since. A list for a
    /// different workout replaces the session only when nothing here is still
    /// waiting for the phone: replacing it then would throw those events
    /// away, and it starts with no focus and nothing skipped.
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
        let focusedLifts = focusedStation.flatMap { snapshot.stations.indices.contains($0) ? snapshot.stations[$0].exerciseIds : nil }
        snapshot = newer
        let onList = Set(newer.sets.map(\.id))
        skipped = skipped.filter { onList.contains($0) }
        holdFocus(on: focusedLifts)
        return .updated
    }

    /// The focus names a workout exercise by a set of it on the list. Once the
    /// phone has every set of it done, the station is found again by its
    /// lifts; one the phone has finished hands on to where the session goes
    /// from there, as the set in hand would.
    private mutating func holdFocus(on lifts: [String]?) {
        guard let key = focus, station(ofWorkoutExercise: key) == nil else { return }
        guard let lifts, let index = snapshot.stations.firstIndex(where: { $0.exerciseIds == lifts }) else {
            focus = nil
            return
        }
        focus = focusKey(ofStation: index) ?? nextStation(open(remainingSets), from: index).flatMap(focusKey(ofStation:))
    }
}
