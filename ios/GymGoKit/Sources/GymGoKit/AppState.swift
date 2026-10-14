import Foundation

/// A rest under way on the wrist. Saved with the rest of the state, so a
/// relaunch mid-rest keeps the countdown.
public struct RestState: Codable, Sendable, Equatable {
    public var id: String
    public var startedAt: Date
    public var endsAt: Date
    /// Its length, with any +30 s added: the 10-second cue needs 20 or more.
    public var seconds: Int
    public var upNext: UpNext
    /// The lift whose set it follows. Nil in a rest saved by build 6. Read
    /// only for a rest saved before `afterStation`.
    public var after: String? = nil
    /// The station whose set it follows (`WatchSession.stationKey(of:)`), so
    /// Up next can be worded again, the phone's way, when the set in hand
    /// moves during the rest. Nil in a rest saved before it.
    public var afterStation: [String]? = nil
}

/// What the watch shows once a session ends: on the wrist, or on the phone.
public struct WatchSummary: Codable, Sendable, Equatable {
    public enum How: String, Codable, Sendable { case finishedHere, finishedOnPhone }
    /// The Health workout: being saved, saved, not saved, or never recorded.
    public enum Health: String, Codable, Sendable { case saving, saved, notSaved, off }

    public var workoutId: String
    public var title: String
    public var how: How
    public var startedAt: String
    public var endedAt: String
    public var setsDone: Int
    public var setsTotal: Int
    public var records: Int
    public var averageHeartRate: Double?
    public var activeKcal: Double?
    public var health: Health

    public var duration: TimeInterval {
        max(0, WatchSession.date(endedAt).timeIntervalSince(WatchSession.date(startedAt)))
    }
}

/// What applying a context did, so the store can drive HealthKit and the
/// haptics. Nothing here has side effects.
public struct ContextChange: Equatable, Sendable {
    /// False when the context was older than the last one applied.
    public var applied = false
    /// The phone's live workout became the session.
    public var adopted: String?
    /// The workout whose session `adopted` replaced.
    public var replaced: String?
    /// The running session's workout ended on the phone.
    public var ended: ClosedWorkout?
    /// The running session took a newer list for the same workout.
    public var updated = false
    /// The phone claimed logging for the running session.
    public var claimed = false
    /// A set's event held for its Undo window, to send now: the session
    /// ended, or the phone took logging over.
    public var released: WatchEvent?
}

/// What logging a set did, beyond the session's own outcome.
public struct LogResult: Sendable, Equatable {
    public var outcome: LogOutcome
    /// The cue it plays.
    public var cue: WatchCue
    /// No set of that lift is left in the session.
    public var lastOfExercise: Bool
    /// The set logged before it, whose Undo window this one closed: its
    /// event goes to the phone now. This set's own event is held
    /// (`WatchAppState.undo`).
    public var released: WatchEvent? = nil
}

/// A set logged on the wrist, in its Undo window: logged and saved at once,
/// so the set in hand moves on and its rest runs, but its event is held back
/// from the phone until the window closes. Undo inside it takes the set back
/// and nothing ever reaches the phone. Saved with the state.
public struct UndoWindow: Codable, Sendable, Equatable {
    /// How long "Logged · Undo" shows.
    public static let seconds: TimeInterval = 5

    public var setId: String
    /// Its `completeSet`, held.
    public var eventId: String
    public var until: Date
    /// It was a record, which Undo takes back.
    public var wasRecord: Bool
    /// The record said before it, said again after an Undo.
    public var recordBefore: SetRecord?
    /// A rest it cut short, which comes back after an Undo if it has not
    /// run out by then.
    public var restBefore: RestState?
}

/// The whole watch app's state, as a value: the phone's latest context, the
/// session on the wrist, who logs it, the rest, the summary, and the count
/// the state reports carry. Codable, saved after every change.
///
/// `apply(_:)` is the contract's "how the watch applies the context"
/// (docs/watch-protocol.md): an older `sentAt` is ignored; the phone's live
/// workout is adopted when nothing runs here, unless it ended on the phone
/// or here; the running session follows its own workout's newer lists; a
/// workout in `closed` ends its session; a phone claim not seen before hands
/// logging to the phone. Every method is pure: the store does the I/O.
public struct WatchAppState: Codable, Sendable, Equatable {
    public struct StartedFrom: Codable, Sendable, Equatable {
        public var key: String
        public var workoutId: String
    }

    /// How many used ready keys and ended workouts are remembered.
    public static let memory = 50
    /// The phone drops events older than this, so the wrist stops resending them.
    public static let eventLifetime: TimeInterval = 7 * 24 * 3600

    public private(set) var lastSentAt: String?
    public private(set) var home: WatchHome?
    public private(set) var settings = WatchSettings(sound: true, vibrate: true)
    public private(set) var phoneClaim: PhoneClaim?
    /// The workout open on the phone at the last context, if any.
    public private(set) var liveWorkoutId: String?

    public private(set) var session: WatchSession?
    public private(set) var owner: WatchStateReport.Owner = .watch
    public private(set) var seenPhoneClaim: String?
    /// A ready session starts at most once.
    public private(set) var usedReadyKeys: [String] = []
    /// Workouts whose session ended while this watch knew of them, on either
    /// device. One of these is never adopted again.
    public private(set) var endedWorkouts: [String] = []
    /// Workouts discarded on the wrist, which the phone may still show as open.
    public private(set) var discardedHere: [String] = []
    /// The ready session the running one was started from on the wrist.
    public private(set) var startedFrom: StartedFrom?
    /// The workout whose session ended last, for the state report.
    public private(set) var lastEnded: String?
    /// When that session began (its snapshot's `startedAt`): the day a
    /// session done here was done, for the Today page and the face once the
    /// phone has not caught up by the next day. Nil in a state saved before.
    public private(set) var lastEndedStartedAt: String?
    /// Events of sessions already over that the phone has not confirmed.
    public private(set) var pending: [WatchEvent] = []

    public private(set) var rest: RestState?
    /// The record to say: from the set just logged, or from the first half of
    /// a superset round, until the rest after it is over.
    public private(set) var lastRecord: SetRecord?
    public private(set) var summary: WatchSummary?
    /// The number on the last state report sent.
    public private(set) var seq = 0
    /// The set just logged on the wrist, while it can still be undone.
    public private(set) var undo: UndoWindow?

    public init() {}

    /// For a watch upgrading from build 4, which saved only the session.
    ///
    /// That session does not come back as running. Build 4 kept every workout
    /// finished on the phone running on the watch, so the one it saved has
    /// most likely ended days ago, and nothing would end it now: the phone
    /// lists only the last day's endings in `closed`. Brought back, it would
    /// hide Today and its Start, and start a Health workout for a session
    /// long over. What the wrist logged in it that the phone has not
    /// confirmed is still sent; if the phone really does still have it open,
    /// its next context hands it back as `live`.
    public init(upgradingFrom session: WatchSession?) {
        pending = session?.outbox ?? []
    }

    /// What the app starts with: the state it saved, else build 4's session,
    /// upgraded, else nothing.
    public static func restore(saved: Data?, build4Session: Data?) -> WatchAppState {
        if let saved, let state = try? JSONDecoder().decode(WatchAppState.self, from: saved) { return state }
        if let build4Session, let session = try? JSONDecoder().decode(WatchSession.self, from: build4Session) {
            return WatchAppState(upgradingFrom: session)
        }
        return WatchAppState()
    }

    enum CodingKeys: String, CodingKey {
        case lastSentAt, home, settings, phoneClaim, liveWorkoutId, session, owner, seenPhoneClaim, usedReadyKeys
        case endedWorkouts, discardedHere, startedFrom, lastEnded, lastEndedStartedAt, pending, rest, lastRecord, summary, seq, undo
    }

    /// Reads a state saved by any earlier build: fields added since default.
    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        lastSentAt = try c.decodeIfPresent(String.self, forKey: .lastSentAt)
        home = try c.decodeIfPresent(WatchHome.self, forKey: .home)
        settings = try c.decodeIfPresent(WatchSettings.self, forKey: .settings) ?? WatchSettings(sound: true, vibrate: true)
        phoneClaim = try c.decodeIfPresent(PhoneClaim.self, forKey: .phoneClaim)
        liveWorkoutId = try c.decodeIfPresent(String.self, forKey: .liveWorkoutId)
        session = try c.decodeIfPresent(WatchSession.self, forKey: .session)
        owner = try c.decodeIfPresent(WatchStateReport.Owner.self, forKey: .owner) ?? .watch
        seenPhoneClaim = try c.decodeIfPresent(String.self, forKey: .seenPhoneClaim)
        usedReadyKeys = try c.decodeIfPresent([String].self, forKey: .usedReadyKeys) ?? []
        endedWorkouts = try c.decodeIfPresent([String].self, forKey: .endedWorkouts) ?? []
        discardedHere = try c.decodeIfPresent([String].self, forKey: .discardedHere) ?? []
        startedFrom = try c.decodeIfPresent(StartedFrom.self, forKey: .startedFrom)
        lastEnded = try c.decodeIfPresent(String.self, forKey: .lastEnded)
        lastEndedStartedAt = try c.decodeIfPresent(String.self, forKey: .lastEndedStartedAt)
        pending = try c.decodeIfPresent([WatchEvent].self, forKey: .pending) ?? []
        rest = try c.decodeIfPresent(RestState.self, forKey: .rest)
        lastRecord = try c.decodeIfPresent(SetRecord.self, forKey: .lastRecord)
        summary = try c.decodeIfPresent(WatchSummary.self, forKey: .summary)
        seq = try c.decodeIfPresent(Int.self, forKey: .seq) ?? 0
        undo = try c.decodeIfPresent(UndoWindow.self, forKey: .undo)
    }

    // MARK: - What the screens read

    public var setInHand: SetInHand? { owner == .watch ? session?.setInHand : nil }
    /// Every event the phone has not confirmed, oldest first.
    public var unconfirmed: [WatchEvent] { pending + (session?.outbox ?? []) }
    /// Events the wrist has made that are still on their way to the phone.
    public var queuedCount: Int { unconfirmed.count }

    // MARK: - From the phone

    /// The phone's context. See the type's comment for the rules.
    @discardableResult
    public mutating func apply(_ context: WatchContext) -> ContextChange {
        var change = ContextChange()
        if let last = lastSentAt, WatchSession.date(context.sentAt) < WatchSession.date(last) { return change }
        change.applied = true
        lastSentAt = context.sentAt
        home = context.home
        settings = context.settings
        phoneClaim = context.phoneClaim
        liveWorkoutId = context.live?.workoutId

        // Finish or Discard on the phone ends the session here. A start on the
        // wrist that the phone threw away did not use its ready key, as a
        // Discard here does not: the phone offers that session again.
        if let running = session, let closed = context.home.closed.first(where: { $0.workoutId == running.workoutId }) {
            // A set in its Undo window goes now: there is nothing to undo it in.
            change.released = closeUndo()
            if closed.how == .discarded { releaseReadyKey(of: running.workoutId) }
            endSession(summary: closed.how == .finished ? .finishedOnPhone : nil, at: closed.at)
            change.ended = closed
        }

        // The phone has the workout the wrist started from this offer, and
        // still offers the same slot: it was deleted, or filed elsewhere, and
        // the slot is open again. The phone decides what is next.
        if let offer = context.home.ready, let started = startedFrom, started.key == offer.key,
           session?.workoutId != started.workoutId,
           context.home.closed.contains(where: { $0.workoutId == started.workoutId }) {
            releaseReadyKey(of: started.workoutId)
        }

        if let live = context.live {
            if var running = session {
                let previous = running.workoutId
                switch running.receive(live) {
                case .updated:
                    session = running
                    change.updated = true
                case .replaced where isAdoptable(live.workoutId, closed: context.home.closed):
                    session = running
                    beginSession()
                    change.adopted = live.workoutId
                    change.replaced = previous
                case .replaced, .ignored:
                    break
                }
            } else if isAdoptable(live.workoutId, closed: context.home.closed) {
                session = WatchSession(snapshot: live)
                beginSession()
                change.adopted = live.workoutId
            }
        }

        // "Log on this phone": a claim this watch has not seen before.
        if let claim = context.phoneClaim, let running = session, claim.workoutId == running.workoutId, isNew(claim) {
            // The phone logs now: a set in its Undo window goes to it at once.
            change.released = change.released ?? closeUndo()
            owner = .phone
            seenPhoneClaim = claim.at
            rest = nil
            lastRecord = nil
            change.claimed = true
        }
        return change
    }

    private func isAdoptable(_ workoutId: String, closed: [ClosedWorkout]) -> Bool {
        !closed.contains { $0.workoutId == workoutId } && !endedWorkouts.contains(workoutId)
    }

    private func isNew(_ claim: PhoneClaim) -> Bool {
        guard let seen = seenPhoneClaim else { return true }
        return WatchSession.date(claim.at) > WatchSession.date(seen)
    }

    /// The phone has applied these events.
    public mutating func acknowledge(_ ids: Set<String>) {
        session?.acknowledge(ids)
        pending.removeAll { ids.contains($0.id) }
    }

    /// Stops resending what the phone would drop anyway.
    public mutating func prune(now: Date) {
        pending.removeAll { now.timeIntervalSince(WatchSession.date($0.at)) > Self.eventLifetime }
    }

    // MARK: - From the wrist

    /// Starts the ready session on the wrist. Nil when something already
    /// runs, or this ready session was started before.
    ///
    /// A start discarded here leaves the offer's IDs spent: the phone writes
    /// a workout ID once, even a discarded one, and cannot offer new ones
    /// until its app next opens. So the same session starts again under IDs
    /// the watch mints (`WatchReady.withFreshIds`), and never under the
    /// discarded workout's.
    public mutating func start(
        _ ready: WatchReady, at date: Date, eventId: String = UUID().uuidString, makeId: () -> String = WatchReady.newId
    ) -> WatchEvent? {
        guard session == nil, !usedReadyKeys.contains(ready.key) else { return nil }
        var offer = ready
        if endedWorkouts.contains(ready.snapshot.workoutId) {
            guard let fresh = ready.withFreshIds(makeId) else { return nil }
            offer = fresh
        }
        let started = WatchSession.start(from: offer, at: date, eventId: eventId)
        session = started
        remember(ready.key, in: &usedReadyKeys)
        beginSession()
        startedFrom = StartedFrom(key: ready.key, workoutId: started.workoutId)
        return started.outbox.first
    }

    /// Logs the set in hand and starts whatever rest follows. Nil while the
    /// phone logs, or when nothing is left to log. Its event is held for the
    /// Undo window (`undo`); the window of the set before it closes, and that
    /// set's event is `released`, to send now.
    public mutating func logSet(weight: Double, reps: Int, at date: Date, eventId: String = UUID().uuidString) -> LogResult? {
        guard owner == .watch, var running = session,
              let outcome = running.logSetInHand(weight: weight, reps: reps, at: date, eventId: eventId) else { return nil }
        session = running
        let released = closeUndo()
        let before = (record: lastRecord, rest: rest)
        // A record is said until the rest after it is over. A set with no
        // rest after it (the first half of a superset) hands its record on,
        // so the set screen says it and the rest that ends the round leads
        // with it; a set logged during a rest starts afresh.
        if let record = outcome.record {
            lastRecord = record
        } else if rest != nil {
            lastRecord = nil
        }
        if let seconds = outcome.restSeconds {
            rest = RestState(
                id: eventId, startedAt: date, endsAt: date.addingTimeInterval(TimeInterval(seconds)), seconds: seconds,
                upNext: outcome.upNext, after: outcome.set.exerciseId, afterStation: running.stationKey(of: outcome.set)
            )
        } else {
            rest = nil
        }
        // A skipped set is never left to do, so it never holds this cue back.
        let lastOfExercise = !running.remainingSets.contains { $0.exerciseId == outcome.set.exerciseId }
        let cue = cueForLoggedSet(record: outcome.record != nil, lastOfExercise: lastOfExercise, rests: rest != nil)
        undo = UndoWindow(
            setId: outcome.set.id, eventId: eventId, until: date.addingTimeInterval(UndoWindow.seconds),
            wasRecord: outcome.record != nil, recordBefore: before.record, restBefore: before.rest
        )
        return LogResult(outcome: outcome, cue: cue, lastOfExercise: lastOfExercise, released: released)
    }

    // MARK: - Undo

    /// The events to send now: every one the phone has not confirmed, less
    /// the set held in its Undo window.
    public func sendable(now: Date) -> [WatchEvent] {
        guard let window = undo, window.until > now else { return unconfirmed }
        return unconfirmed.filter { $0.id != window.eventId }
    }

    /// The Undo window closes: the set stays logged, and its event is
    /// returned, to send now. Nil with no window open.
    public mutating func closeUndo() -> WatchEvent? {
        guard let window = undo else { return nil }
        undo = nil
        return unconfirmed.first { $0.id == window.eventId }
    }

    /// The window closes if its time is up by `now`.
    public mutating func closeUndo(ifOverAt now: Date) -> WatchEvent? {
        guard let window = undo, window.until <= now else { return nil }
        return closeUndo()
    }

    /// Undo, inside the window: the set is no longer logged, its event never
    /// leaves, and it is back in hand. The rest it started is cancelled; a
    /// rest it cut short comes back if it has not run out, and the record
    /// said before it is said again. Returns the set as it was logged, or nil
    /// when there is nothing to undo (no window, or its time is up).
    public mutating func undoLastSet(at now: Date) -> LoggedSet? {
        guard let window = undo, window.until > now, owner == .watch, var running = session,
              let entry = running.logged[window.setId],
              running.unlog(window.setId, eventId: window.eventId, wasRecord: window.wasRecord) else { return nil }
        undo = nil
        session = running
        lastRecord = window.recordBefore
        // Any rest now began with this set, or after it (a partner skipped
        // since): a later set would have closed the window.
        rest = window.restBefore.flatMap { $0.endsAt > now ? $0 : nil }
        return entry
    }

    /// "Skip this set". False while the phone logs, or with nothing in hand.
    public mutating func skipSetInHand(at date: Date, restId: String = UUID().uuidString) -> Bool {
        move(at: date, restId: restId) { $0.skipSetInHand() }
    }

    /// "Done with this lift": the rest of the station in hand.
    public mutating func skipStationInHand(at date: Date, restId: String = UUID().uuidString) -> Bool {
        move(at: date, restId: restId) { $0.skipStationInHand() }
    }

    /// A station tapped on This session. Its skipped sets come back when
    /// they are all it has left.
    public mutating func go(toStation index: Int, at date: Date) -> Bool {
        move(at: date, restId: UUID().uuidString) { $0.go(toStation: index) ? [] : nil }
    }

    /// The set in hand moved on the wrist (`change` returns the sets it
    /// skipped, nil when nothing moved). A rest under way says what is next
    /// now. With none, a skip of the set straight after the one just logged,
    /// which rested only because that set followed (a superset's partner, a
    /// drop), gives the set just logged the rest the skipped one would have
    /// ended its round with.
    private mutating func move(at date: Date, restId: String, _ change: (inout WatchSession) -> [String]?) -> Bool {
        guard owner == .watch, var running = session, let newlySkipped = change(&running) else { return false }
        session = running
        if var current = rest {
            current.upNext = running.upNext(after: current)
            rest = current
        } else if let last = running.lastLoggedSet, let follower = running.set(after: last),
                  newlySkipped.contains(follower.id), let seconds = running.restHandedOn(after: last) {
            rest = RestState(
                id: restId, startedAt: date, endsAt: date.addingTimeInterval(TimeInterval(seconds)), seconds: seconds,
                upNext: running.upNext(afterStation: last.station), after: last.exerciseId,
                afterStation: running.stationKey(of: last)
            )
        }
        return true
    }

    public mutating func skipRest(at date: Date, eventId: String = UUID().uuidString) -> WatchEvent? {
        guard rest != nil, var running = session else { return nil }
        rest = nil
        lastRecord = nil
        let event = running.skipRest(at: date, eventId: eventId)
        session = running
        return event
    }

    /// More rest, or less, never ending before now.
    public mutating func adjustRest(by seconds: Int, now: Date) -> RestState? {
        guard var current = rest else { return nil }
        current.endsAt = max(now, current.endsAt.addingTimeInterval(TimeInterval(seconds)))
        current.seconds = max(0, current.seconds + seconds)
        rest = current
        return current
    }

    /// The rest ran its course. False when that rest is no longer the one under way.
    public mutating func restRanOut(id: String) -> Bool {
        guard rest?.id == id else { return false }
        rest = nil
        lastRecord = nil
        return true
    }

    /// A rest that ended while the app was not running ends quietly.
    public mutating func expireRest(now: Date) -> Bool {
        guard let current = rest, current.endsAt <= now else { return false }
        rest = nil
        lastRecord = nil
        return true
    }

    /// Finish and save on the wrist. A set still in its Undo window is in the
    /// finish's `sets`; the store sends its own event first (`closeUndo`).
    public mutating func finish(at date: Date, eventId: String = UUID().uuidString) -> WatchEvent? {
        guard var running = session, let event = running.finish(at: date, eventId: eventId) else { return nil }
        session = running
        endSession(summary: .finishedHere, at: WatchSession.isoString(date))
        return event
    }

    /// Discard on the wrist, before the first set. A discarded start did not
    /// use its ready key: the same session may start again, under new IDs
    /// (see `start`). The discarded workout's own IDs are never used again:
    /// `endedWorkouts` keeps them.
    public mutating func discard(at date: Date, eventId: String = UUID().uuidString) -> WatchEvent? {
        guard var running = session, let event = running.discard(at: date, eventId: eventId) else { return nil }
        session = running
        releaseReadyKey(of: running.workoutId)
        remember(running.workoutId, in: &discardedHere)
        endSession(summary: nil, at: WatchSession.isoString(date))
        return event
    }

    /// The ready key a workout was started from on the wrist may start again.
    private mutating func releaseReadyKey(of workoutId: String) {
        guard let started = startedFrom, started.workoutId == workoutId else { return }
        usedReadyKeys.removeAll { $0 == started.key }
    }

    /// "Log here instead": the watch takes logging back, having seen the
    /// phone's claim, which is what lets the phone accept it.
    public mutating func reclaim() -> Bool {
        guard let running = session, owner == .phone else { return false }
        owner = .watch
        if let claim = phoneClaim, claim.workoutId == running.workoutId { seenPhoneClaim = claim.at }
        return true
    }

    public mutating func closeSummary() {
        summary = nil
    }

    /// The store fills in what HealthKit knows.
    public mutating func updateSummary(_ change: (inout WatchSummary) -> Void) {
        guard var current = summary else { return }
        change(&current)
        summary = current
    }

    // MARK: - To the phone

    /// The next state report. Every one carries a higher `seq`. `paused` is
    /// when the Health workout was paused (`WorkoutController.pausedAt`), or
    /// nil while it records.
    public mutating func report(
        at date: Date, heartRate: Double?, activeKcal: Double?, health: WatchStateReport.Health, paused: Date? = nil
    ) -> WatchStateReport {
        seq += 1
        let running = session
        return WatchStateReport(
            at: WatchSession.isoString(date),
            seq: seq,
            workoutId: running?.workoutId ?? lastEnded,
            session: running != nil ? .running : (lastEnded != nil ? .ended : .none),
            owner: owner,
            seenPhoneClaim: seenPhoneClaim,
            setId: setInHand?.set.id,
            inHand: inHandReport,
            rest: rest.map { .init(endsAt: WatchSession.isoString($0.endsAt), startedAt: WatchSession.isoString($0.startedAt), upNext: $0.upNext) },
            skipped: running?.skipped ?? [],
            paused: running != nil ? paused.map(WatchSession.isoString) : nil,
            heartRate: running != nil ? heartRate : nil,
            activeKcal: running != nil ? activeKcal : nil,
            health: health
        )
    }

    /// The set in hand as its screen shows it: the lift, and "Set 2 of 4 ·
    /// 100 × 5". Nil while the phone logs, or with nothing in hand.
    var inHandReport: WatchStateReport.InHand? {
        setInHand.map { WatchStateReport.InHand(name: $0.lift.name, detail: $0.screenDetail) }
    }

    /// What a state report says, less its clock, its number and the live
    /// metrics: when this changes, a report goes at once.
    public struct ReportKey: Equatable, Sendable {
        var workoutId: String?
        var running: Bool
        var owner: WatchStateReport.Owner
        var seenPhoneClaim: String?
        var setId: String?
        var inHand: WatchStateReport.InHand?
        var restEndsAt: Date?
        var restUpNext: UpNext?
        var skipped: [String]
        var paused: Date?
    }

    /// The report's key with the workout recording, or paused at `paused`.
    public func reportKey(paused: Date?) -> ReportKey {
        ReportKey(
            workoutId: session?.workoutId ?? lastEnded, running: session != nil, owner: owner,
            seenPhoneClaim: seenPhoneClaim, setId: setInHand?.set.id, inHand: inHandReport,
            restEndsAt: rest?.endsAt, restUpNext: rest?.upNext, skipped: session?.skipped ?? [],
            paused: session != nil ? paused : nil
        )
    }

    public var reportKey: ReportKey { reportKey(paused: nil) }

    // MARK: - Session lifecycle

    /// A new session on the wrist: the watch logs it, with nothing carried over.
    private mutating func beginSession() {
        owner = .watch
        seenPhoneClaim = nil
        rest = nil
        lastRecord = nil
        summary = nil
        undo = nil
    }

    private mutating func endSession(summary how: WatchSummary.How?, at endedAt: String) {
        guard let running = session else { return }
        pending.append(contentsOf: running.outbox)
        remember(running.workoutId, in: &endedWorkouts)
        lastEnded = running.workoutId
        lastEndedStartedAt = running.snapshot.startedAt
        if let how {
            let progress = running.progress
            summary = WatchSummary(
                workoutId: running.workoutId, title: running.snapshot.title, how: how,
                startedAt: running.snapshot.startedAt, endedAt: endedAt,
                setsDone: progress.done, setsTotal: progress.total, records: running.records,
                averageHeartRate: nil, activeKcal: nil, health: .off
            )
        } else {
            summary = nil
        }
        session = nil
        rest = nil
        lastRecord = nil
        owner = .watch
        seenPhoneClaim = nil
        // Its set's event is in `pending` now, and goes with the rest of them.
        undo = nil
    }

    private func remember(_ value: String, in list: inout [String]) {
        list.removeAll { $0 == value }
        list.append(value)
        if list.count > Self.memory { list.removeFirst(list.count - Self.memory) }
    }
}
