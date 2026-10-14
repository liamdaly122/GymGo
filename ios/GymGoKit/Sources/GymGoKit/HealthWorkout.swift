import Foundation

// The decisions behind the watch's Health workout, kept here where they are
// tested: GymGoWatchUI's WorkoutController does the HealthKit calls and its
// WatchSessionStore asks these what to do. Watch-only rules, with no
// TypeScript twin.

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
