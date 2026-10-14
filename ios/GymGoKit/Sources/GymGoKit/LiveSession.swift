import Foundation

// The iPhone's Live Activity for a session the watch runs: what it shows,
// and when it starts, updates and ends. Pure, so `swift test` covers it on the
// Mac. The ActivityKit half is LiveSessionAttributes.swift (iOS only), the
// views are in the "GymGo Live Activity" extension, and the phone's
// LiveSessionActivities.swift does the starting and ending.

/// What the Live Activity shows, as the dynamic `ContentState`. Small on
/// purpose: ActivityKit caps attributes and state at 4 KB together.
public struct LiveSessionContent: Codable, Hashable, Sendable {
    public enum Phase: String, Codable, Hashable, Sendable {
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
    /// The exercise of the set in hand ("Bench Press"), when the phone can tell.
    public var exercise: String?
    /// "Set 2 of 4 · 100 × 5", when the phone can tell.
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

    public init(
        phase: Phase, exercise: String? = nil, detail: String? = nil, restStart: Date? = nil,
        restEnd: Date? = nil, upNext: String? = nil, upNextDetail: String? = nil, heartRate: Int? = nil
    ) {
        self.phase = phase
        self.exercise = exercise
        self.detail = detail
        self.restStart = restStart
        self.restEnd = restEnd
        self.upNext = upNext
        self.upNextDetail = upNextDetail
        self.heartRate = heartRate
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
    /// - showing: the workout of the Live Activity on screen, if any.
    /// - mayStart: the app is in the foreground (or holds HealthKit's
    ///   one-time permission from a mirrored session) and Live Activities are on.
    /// - declined: workouts whose Live Activity the person swiped away. Not
    ///   started again for them.
    public static func step(
        report: WatchStateReport?, receivedAt: Date?, now: Date,
        showing: String?, mayStart: Bool, declined: Set<String>
    ) -> Step {
        guard let report, let receivedAt, report.session == .running, let workoutId = report.workoutId else {
            return showing == nil ? .nothing : .end
        }
        if now.timeIntervalSince(receivedAt) > staleAfter {
            // The view has already said so (staleDate); this is the chance to tidy up.
            return showing == nil ? .nothing : .end
        }
        if showing == workoutId { return .update }
        let startable = mayStart && !declined.contains(workoutId)
        if let showing, showing != workoutId { return startable ? .replace(workoutId: workoutId) : .end }
        return startable ? .start(workoutId: workoutId) : .nothing
    }

    /// The content for a running report.
    ///
    /// - inHand: the set in hand, by name (see `inHand(setId:in:)`).
    /// - restStart: when this rest began. The report carries only its end;
    ///   until it carries a start, the phone passes the first time it saw
    ///   this rest, which makes the bar start full a moment late.
    public static func content(for report: WatchStateReport, inHand: LiveSessionInHand?, restStart: Date?) -> LiveSessionContent {
        let heartRate = report.heartRate.map { Int($0.rounded()) }
        if report.owner == .phone {
            return LiveSessionContent(phase: .onPhone, heartRate: heartRate)
        }
        if let rest = report.rest {
            let end = WatchSession.date(rest.endsAt)
            if end > .distantPast {
                return LiveSessionContent(
                    phase: .resting, exercise: inHand?.exercise, detail: inHand?.detail,
                    restStart: min(restStart ?? end, end), restEnd: end,
                    upNext: rest.upNext.name, upNextDetail: rest.upNext.detail, heartRate: heartRate
                )
            }
        }
        return LiveSessionContent(phase: .lifting, exercise: inHand?.exercise, detail: inHand?.detail, heartRate: heartRate)
    }

    /// The set in hand, named from a snapshot the phone sent: the lift's name
    /// and "Set 2 of 4 · 100 × 5", formatted as the snapshot's own "Up next"
    /// lines are. The numbers are the phone's starting numbers; the watch may
    /// have carried a heavier set forward since.
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
    /// the first report; the title from either snapshot, else "Workout".
    public static func facts(workoutId: String, context: WatchContext?, startEvents: [WatchEvent], firstSeen: Date) -> LiveSessionFacts {
        let snapshot = snapshot(for: workoutId, in: context)
        let title = snapshot?.title ?? "Workout"
        if let live = context?.live, live.workoutId == workoutId {
            let started = WatchSession.date(live.startedAt)
            if started > .distantPast { return LiveSessionFacts(title: title, startedAt: started) }
        }
        if let start = startEvents.first(where: { $0.kind == .startWorkout && $0.workoutId == workoutId }) {
            let started = WatchSession.date(start.at)
            if started > .distantPast { return LiveSessionFacts(title: title, startedAt: started) }
        }
        return LiveSessionFacts(title: title, startedAt: firstSeen)
    }

    private static func number(_ value: Double) -> String {
        let rounded = (value * 100).rounded() / 100
        return rounded == rounded.rounded() ? String(Int(rounded)) : String(rounded)
    }
}
