import Foundation

// The iPhone's Live Activity for a session the watch runs: what it shows,
// and when it starts, updates and ends. Pure, so `swift test` covers it on the
// Mac. The ActivityKit half is LiveSessionAttributes.swift (iOS only), the
// views are in the "GymGo Live Activity" extension, and the phone's
// LiveSessionActivities.swift does the starting and ending
// (docs/watch-protocol.md, "The Live Activity on the iPhone").

/// What the Live Activity shows, as the dynamic `ContentState`. Small on
/// purpose: ActivityKit caps attributes and state at 4 KB together.
public struct LiveSessionContent: Codable, Hashable, Sendable {
    public enum Phase: String, Codable, Hashable, Sendable {
        /// Put up at the phone's Start, before the watch has reported:
        /// "Starting on your watch".
        case starting
        /// A set is in hand on the watch.
        case lifting
        /// A rest is counting down. `restStart` and `restEnd` are set.
        case resting
        /// The phone took logging back ("Log on this phone").
        case onPhone
        /// The watch's session is over. Shown only by the final content of `end`.
        case ended
    }

    public var phase: Phase
    /// The lift of the set in hand ("Bench Press").
    public var exercise: String?
    /// "Set 2 of 4 · 100 × 5", as the watch's set screen shows it.
    public var detail: String?
    /// The rest's span, on the watch's clock (a paired watch and phone agree to
    /// well under a second). The views count down to `restEnd` by themselves.
    public var restStart: Date?
    public var restEnd: Date?
    /// The watch's own "Up next" for the rest: an exercise's name, and its set or outline.
    public var upNext: String?
    public var upNextDetail: String?
    /// Beats per minute, most recent.
    public var heartRate: Int?
    /// When the watch paused the workout, while it is paused. The elapsed
    /// clock stops there; a rest keeps its wall-clock end.
    public var pausedAt: Date?

    public init(
        phase: Phase, exercise: String? = nil, detail: String? = nil, restStart: Date? = nil,
        restEnd: Date? = nil, upNext: String? = nil, upNextDetail: String? = nil, heartRate: Int? = nil,
        pausedAt: Date? = nil
    ) {
        self.phase = phase
        self.exercise = exercise
        self.detail = detail
        self.restStart = restStart
        self.restEnd = restEnd
        self.upNext = upNext
        self.upNextDetail = upNextDetail
        self.heartRate = heartRate
        self.pausedAt = pausedAt
    }
}

/// The set in hand, as the Live Activity names it.
public struct LiveSessionInHand: Hashable, Sendable {
    public var exercise: String
    public var detail: String
    public init(exercise: String, detail: String) {
        self.exercise = exercise
        self.detail = detail
    }
}

/// What the Live Activity's fixed attributes need, worked out once at start.
public struct LiveSessionFacts: Hashable, Sendable {
    public var title: String
    public var startedAt: Date
    public init(title: String, startedAt: Date) {
        self.title = title
        self.startedAt = startedAt
    }
}

public enum LiveSession {
    /// The same five minutes as `WATCH_STALE_MS` (src/domain/companion.ts):
    /// past it the phone is the logging surface again, and the Live Activity
    /// says the watch is out of touch, then ends at the next chance.
    public static let staleAfter: TimeInterval = 5 * 60
    /// `WATCH_PAUSED_STALE_MS`: a pause is a deliberate break rather than a
    /// watch gone missing, so the companion waits an hour, and so does this.
    public static let pausedStaleAfter: TimeInterval = 60 * 60

    /// How long a report counts as fresh: `staleAfter(report)` in companion.ts.
    public static func staleAfter(_ report: WatchStateReport?) -> TimeInterval {
        report?.paused != nil ? pausedStaleAfter : staleAfter
    }

    /// The Live Activity on screen, as the rule needs it.
    public struct Showing: Equatable, Sendable {
        /// The workout it is for.
        public var workoutId: String
        /// Set while it is still "Starting on your watch": when the phone's
        /// Start put it up. No report for its workout has arrived yet.
        public var waitingSince: Date?
        public init(workoutId: String, waitingSince: Date?) {
            self.workoutId = workoutId
            self.waitingSince = waitingSince
        }
    }

    public enum Step: Equatable, Sendable {
        case nothing
        /// Request a Live Activity for this workout. Only ever returned when `mayStart`.
        case start(workoutId: String)
        /// Update the one on screen.
        case update
        /// End the one on screen.
        case end
        /// End the one on screen (another workout's) and start this one.
        case replace(workoutId: String)
    }

    /// What to do with the newest report.
    ///
    /// - showing: the Live Activity on screen, if any.
    /// - mayStart: the app is in the foreground (or holds HealthKit's
    ///   one-time permission from a mirrored session) and Live Activities are on.
    /// - declined: workouts whose Live Activity the person swiped away. Not
    ///   started again for them.
    public static func step(
        report: WatchStateReport?, receivedAt: Date?, now: Date,
        showing: Showing?, mayStart: Bool, declined: Set<String>
    ) -> Step {
        // A running session the watch has spoken about lately, if there is one.
        var running: String?
        if let report, let receivedAt, report.session == .running, let workoutId = report.workoutId,
           now.timeIntervalSince(receivedAt) <= staleAfter(report) {
            running = workoutId
        }
        func startable(_ workoutId: String) -> Bool { mayStart && !declined.contains(workoutId) }

        guard let showing else {
            guard let running, startable(running) else { return .nothing }
            return .start(workoutId: running)
        }
        if let report, report.workoutId == showing.workoutId {
            // Its own report: running and fresh, or over. A stale one has
            // already said "Out of touch" (the stale date); this tidies up.
            return running == showing.workoutId ? .update : .end
        }
        // Another workout's report, or none.
        if let running, let receivedAt {
            // Put up at the tap, it ignores what the watch said before then.
            let afterTheTap = showing.waitingSince.map { receivedAt >= $0 } ?? true
            if afterTheTap { return startable(running) ? .replace(workoutId: running) : .end }
        }
        // Put up at the phone's Start: the watch is still opening GymGo, so what
        // the phone last heard is about the workout before, or "no session".
        // It waits as long as a report would count as fresh.
        if let since = showing.waitingSince, now.timeIntervalSince(since) <= staleAfter {
            return .nothing
        }
        return .end
    }

    /// The phone's Start, which opens GymGo on the watch for `workoutId`. The
    /// app is in the foreground at the tap, which is when ActivityKit allows a
    /// start, so the activity goes up now ("Starting on your watch") rather
    /// than when the watch's first report arrives, by which time the phone may
    /// well be locked in a pocket.
    public static func stepForPhoneStart(workoutId: String, showing: Showing?, mayStart: Bool) -> Step {
        guard mayStart else { return .nothing }
        guard let showing else { return .start(workoutId: workoutId) }
        return showing.workoutId == workoutId ? .nothing : .replace(workoutId: workoutId)
    }

    /// The workout the phone's Start is for, and its title and start: the live
    /// workout in the context just sent. Nil with none open.
    public static func phoneStart(context: WatchContext?, now: Date) -> (workoutId: String, facts: LiveSessionFacts)? {
        guard let live = context?.live else { return nil }
        let started = WatchSession.date(live.startedAt)
        return (live.workoutId, LiveSessionFacts(title: live.title, startedAt: started > .distantPast ? started : now))
    }

    /// What it shows from the phone's Start until the watch's first report.
    public static let starting = LiveSessionContent(phase: .starting)

    /// The content for a running report.
    ///
    /// - inHandFallback: the set in hand as the phone reads it from the
    ///   snapshot (`inHand(setId:in:)`), for a build 6 watch, which sends no
    ///   `inHand`. A build 7 watch's own words always win.
    /// - restFirstSeen: when the phone first saw this rest (`restStart(for:receivedAt:held:)`),
    ///   for a build 6 watch, which sends no `rest.startedAt`.
    public static func content(
        for report: WatchStateReport, inHandFallback: LiveSessionInHand?, restFirstSeen: Date?
    ) -> LiveSessionContent {
        let heartRate = report.heartRate.map { Int($0.rounded()) }
        let pausedAt = report.paused.map { WatchSession.date($0) }.flatMap { $0 > .distantPast ? $0 : nil }
        if report.owner == .phone {
            return LiveSessionContent(phase: .onPhone, heartRate: heartRate)
        }
        let inHand = report.inHand.map { LiveSessionInHand(exercise: $0.name, detail: $0.detail) }
            ?? (report.setId != nil ? inHandFallback : nil)
        if let rest = report.rest {
            let end = WatchSession.date(rest.endsAt)
            if end > .distantPast {
                let start = exactStart(rest) ?? restFirstSeen ?? end
                return LiveSessionContent(
                    phase: .resting, exercise: inHand?.exercise, detail: inHand?.detail,
                    restStart: min(start, end), restEnd: end,
                    upNext: rest.upNext.name, upNextDetail: rest.upNext.detail, heartRate: heartRate,
                    pausedAt: pausedAt
                )
            }
        }
        return LiveSessionContent(
            phase: .lifting, exercise: inHand?.exercise, detail: inHand?.detail, heartRate: heartRate, pausedAt: pausedAt
        )
    }

    /// A rest as the phone first saw it, for a watch that does not say when
    /// its rests began.
    public struct RestSighting: Equatable, Sendable {
        public var setId: String?
        public var endsAt: Date
        public var firstSeen: Date
        public init(setId: String?, endsAt: Date, firstSeen: Date) {
            self.setId = setId
            self.endsAt = endsAt
            self.firstSeen = firstSeen
        }
    }

    /// When the report's rest began: the watch's own `rest.startedAt`, or
    /// failing that the first time the phone saw this rest. +30 s on the same
    /// set keeps the first sighting, so the bar does not jump back to full.
    /// Returns the sighting to hold for the next report.
    public static func restStart(
        for report: WatchStateReport, receivedAt: Date, held: RestSighting?
    ) -> (start: Date?, held: RestSighting?) {
        guard let rest = report.rest else { return (nil, nil) }
        let endsAt = WatchSession.date(rest.endsAt)
        guard endsAt > .distantPast else { return (nil, nil) }
        if let exact = exactStart(rest) {
            return (exact, RestSighting(setId: report.setId, endsAt: endsAt, firstSeen: exact))
        }
        if let held, held.endsAt == endsAt { return (held.firstSeen, held) }
        if let held, held.setId == report.setId, held.endsAt > receivedAt, endsAt > held.endsAt {
            return (held.firstSeen, RestSighting(setId: report.setId, endsAt: endsAt, firstSeen: held.firstSeen))
        }
        return (receivedAt, RestSighting(setId: report.setId, endsAt: endsAt, firstSeen: receivedAt))
    }

    private static func exactStart(_ rest: WatchStateReport.Rest) -> Date? {
        let start = WatchSession.date(rest.startedAt)
        return start > .distantPast ? start : nil
    }

    /// The set in hand, named from a snapshot the phone sent: the lift's name
    /// and "Set 2 of 4 · 100 × 5", formatted as the snapshot's own "Up next"
    /// lines are. Only for a build 6 watch: the numbers are the phone's
    /// starting numbers, and the watch may have carried others forward since.
    public static func inHand(setId: String, in snapshot: WatchSnapshot) -> LiveSessionInHand? {
        guard let set = snapshot.sets.first(where: { $0.id == setId }),
              let lift = snapshot.lifts[set.exerciseId] else { return nil }
        var detail = set.label
        if let weight = set.weight, let reps = set.reps, reps > 0 {
            detail += " · \(weight > 0 ? number(weight) : "BW") × \(reps)"
        }
        return LiveSessionInHand(exercise: lift.name, detail: detail)
    }

    /// The snapshot that describes `workoutId`, from the context the phone last
    /// sent: the live workout, or the ready session the wrist started. Nil when
    /// the wrist re-minted its IDs after a Discard (FreshIds.swift) and the
    /// phone has not yet drained that start.
    public static func snapshot(for workoutId: String, in context: WatchContext?) -> WatchSnapshot? {
        guard let context else { return nil }
        if let live = context.live, live.workoutId == workoutId { return live }
        if let ready = context.home.ready, ready.snapshot.workoutId == workoutId { return ready.snapshot }
        return nil
    }

    /// Title and start for the attributes. The start comes from the live
    /// snapshot, else the wrist's startWorkout event still in the inbox, else
    /// the first report. The title comes from either snapshot, else from the
    /// ready session the start event names by routine (a start re-minted on
    /// the wrist after a Discard), else "Workout".
    public static func facts(workoutId: String, context: WatchContext?, startEvents: [WatchEvent], firstSeen: Date) -> LiveSessionFacts {
        let start = startEvents.first(where: { $0.kind == .startWorkout && $0.workoutId == workoutId })
        var title = snapshot(for: workoutId, in: context)?.title
        if title == nil, let ready = context?.home.ready, let routineId = start?.routineId, routineId == ready.routineId {
            title = ready.snapshot.title
        }
        let named = title ?? "Workout"
        if let live = context?.live, live.workoutId == workoutId {
            let started = WatchSession.date(live.startedAt)
            if started > .distantPast { return LiveSessionFacts(title: named, startedAt: started) }
        }
        if let start {
            let started = WatchSession.date(start.at)
            if started > .distantPast { return LiveSessionFacts(title: named, startedAt: started) }
        }
        return LiveSessionFacts(title: named, startedAt: firstSeen)
    }

    private static func number(_ value: Double) -> String {
        let rounded = (value * 100).rounded() / 100
        return rounded == rounded.rounded() ? String(Int(rounded)) : String(rounded)
    }
}
