import Foundation

// The decisions behind the watch's Health workout, kept here where they are
// tested: GymGoWatchUI's WorkoutController does the HealthKit calls and its
// WatchSessionStore asks these what to do. Watch-only rules, with no
// TypeScript twin.

/// What becomes of the Health workout recording now.
public enum HealthRecordingAction: Equatable, Sendable {
    /// It records the running session, or may yet record one: leave it.
    case keep
    /// It records the running session, untagged: tag it.
    case tag(String)
    /// The GymGo workout it recorded ended as a finish: save it, tagged with
    /// this workout first when it is untagged.
    case finish(tag: String?)
    /// The GymGo workout it recorded was thrown away, or nothing stands
    /// behind it: end it without saving.
    case discard
}

extension WatchAppState {
    /// How long before a Health workout began a phone ending still counts as
    /// the ending of the workout it was started for: the phone starts the
    /// workout, then opens the watch app, which starts recording a moment
    /// later, on a clock that may differ by a little.
    public static let strayRecordingSlack: TimeInterval = 120
    /// A recording shorter than this is a mistaken start, never saved.
    public static let shortestRecordingSaved: TimeInterval = 60

    /// The Health workout recording now, tagged with `tagged` (nil when it is
    /// not tagged yet), which began at `startedAt`: is it this session's, or
    /// is it left over from a workout already over?
    ///
    /// - Tagged with the running session: leave it. Untagged with a session
    ///   running: it is that session's.
    /// - Tagged with a workout that ended (here or on the phone): finish it
    ///   if that workout was finished, throw it away if it was discarded. A
    ///   crash mid-finish leaves exactly this behind.
    /// - Untagged with no session: the phone opened the app to record a
    ///   workout, and the context naming it has not arrived. Once a context
    ///   sent after the recording began has no workout open, that workout is
    ///   over: saved if it ended as a finish just now and the recording is
    ///   more than a few seconds long, otherwise thrown away.
    /// - Anything else is left alone: the idle page offers to end it.
    public func healthRecordingAction(taggedWith tagged: String?, startedAt: Date?, now: Date) -> HealthRecordingAction {
        let closed = home?.closed ?? []
        if let running = session {
            guard let tagged else { return .tag(running.workoutId) }
            if tagged == running.workoutId { return .keep }
            return endedAction(tagged, closed: closed) ?? .keep
        }
        if let tagged { return endedAction(tagged, closed: closed) ?? .keep }

        // Untagged, with nothing running here.
        guard let startedAt, liveWorkoutId == nil, let sentAt = lastSentAt,
              WatchSession.date(sentAt) > startedAt else { return .keep }
        let justClosed = closed
            .filter { WatchSession.date($0.at) >= startedAt.addingTimeInterval(-Self.strayRecordingSlack) }
            .max { WatchSession.date($0.at) < WatchSession.date($1.at) }
        if let justClosed, justClosed.how == .finished, now.timeIntervalSince(startedAt) >= Self.shortestRecordingSaved {
            return .finish(tag: justClosed.workoutId)
        }
        return .discard
    }

    /// A workout this watch saw end: how it ended. Nil when it did not.
    private func endedAction(_ workoutId: String, closed: [ClosedWorkout]) -> HealthRecordingAction? {
        if discardedHere.contains(workoutId) || closed.contains(where: { $0.workoutId == workoutId && $0.how == .discarded }) {
            return .discard
        }
        if endedWorkouts.contains(workoutId) || summary?.workoutId == workoutId
            || closed.contains(where: { $0.workoutId == workoutId && $0.how == .finished }) {
            return .finish(tag: nil)
        }
        return nil
    }
}

// MARK: - Retrying a Health workout that would not start

/// Which workout's Health workout is not tried again on every wake.
///
/// A start that fails while the app may save workouts (another workout app
/// took over, HealthKit refused) is not retried on every wake. A start that
/// failed because Health had not been asked yet is retried: the next
/// foreground asks, and a grant clears any block. Refused or unavailable is
/// read fresh on each wake, and never blocks.
public struct HealthRetry: Equatable, Sendable {
    public private(set) var blocked: String?

    public init() {}

    public mutating func failed(_ workoutId: String?, authorized: Bool, notDetermined: Bool = false) {
        guard let workoutId, authorized, !notDetermined else { return }
        blocked = workoutId
    }

    /// Health was granted just now.
    public mutating func granted() {
        blocked = nil
    }

    public func mayStart(_ workoutId: String) -> Bool {
        blocked != workoutId
    }
}

// MARK: - The rest-over cue when nothing keeps the app running

/// A local notification standing in for the rest-over cue.
///
/// Wrist-down, only a running Health workout keeps a watch app running: the
/// cues timed in the app's own process (`restCues`) stop when it is
/// suspended. When Health is not recording, the rest's end goes to the system
/// too, as a notification with a sound, which plays its own haptic. While
/// Health records, the in-process cues play and no notification is wanted.
public struct RestAlert: Equatable, Sendable {
    /// The rest's ID: one notification per rest, replaced when it changes.
    public var id: String
    public var fireAt: Date
    public var upNext: UpNext

    /// The notification the rest under way wants, if any. None with the
    /// phone's Vibrate switch off, as the in-process cues are off then too.
    public static func wanted(for rest: RestState?, healthRecording: Bool, vibrate: Bool, now: Date) -> RestAlert? {
        guard let rest, vibrate, !healthRecording, rest.endsAt > now else { return nil }
        return RestAlert(id: rest.id, fireAt: rest.endsAt, upNext: rest.upNext)
    }

    /// What to remove and what to add, to go from the notification scheduled
    /// to the one wanted. Every change of rest, or of Health, goes through here.
    public static func reconcile(scheduled: RestAlert?, wanted: RestAlert?) -> (remove: String?, add: RestAlert?) {
        if scheduled == wanted { return (nil, nil) }
        return (scheduled?.id, wanted)
    }
}

/// Whether the rest-over cue plays once more, `restOverRepeatSeconds` after
/// the first: not if the screen was woken or touched in between, not once
/// another rest has begun, and not once the session the rest belonged to has
/// ended or been replaced.
public func restOverPlaysAgain(noticed: Bool, restRunning: Bool, restSession: String?, runningSession: String?) -> Bool {
    !noticed && !restRunning && restSession != nil && restSession == runningSession
}
