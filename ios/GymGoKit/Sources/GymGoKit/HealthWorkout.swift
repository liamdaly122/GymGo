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
