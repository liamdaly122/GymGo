import Foundation

// The watch's haptics, as data: which taps each moment plays and when a rest
// plays them. docs/watch-protocol.md, "Haptics on the watch", is the table;
// GymGoWatchUI's Haptics plays it. There is no stronger tap on the watch:
// strength comes from the heavier types and from repeating them.

/// `WKHapticType`, by name, so the table can live where it is tested.
public enum HapticKind: String, Sendable, CaseIterable {
    case notification, directionUp, directionDown, success, failure, retry, start, stop, click

    /// The long ones: the next tap waits at least 600 ms after these.
    public var isLong: Bool { [.notification, .success, .retry, .failure].contains(self) }
}

/// One tap, and how long to wait before it.
public struct HapticStep: Equatable, Sendable {
    public var kind: HapticKind
    /// Milliseconds after the previous tap.
    public var after: Int

    public init(_ kind: HapticKind, after: Int = 0) {
        self.kind = kind
        self.after = after
    }
}

/// Every moment the watch taps the wrist.
public enum WatchCue: String, Sendable, CaseIterable {
    case workoutStarted
    case restBegins
    case partnerNext
    case lastSetOfExercise
    case record
    case tenSecondsLeft
    case countdown
    case restOver
    /// +30 s or Skip.
    case restAdjusted
    case endedOnPhone
    case savedToHealth
    case failed
    /// The workout paused, asked for on the wrist: Pause on screen, the
    /// Action and side buttons, the Crown and side button. Wrist-down, with
    /// the rest screen unchanged, it is the only sign the press worked.
    case paused
    /// The workout resumed, asked for on the wrist: Resume, the buttons, or
    /// an Action press while paused. Never the resume that logging a set
    /// causes, which the set's own cue covers, and never a recovery.
    case resumed

    public var steps: [HapticStep] {
        switch self {
        case .paused: [HapticStep(.stop)]
        case .resumed: [HapticStep(.start)]
        case .workoutStarted: [HapticStep(.start)]
        case .restBegins: [HapticStep(.stop), HapticStep(.directionDown, after: 250)]
        case .partnerNext: [HapticStep(.directionUp)]
        case .lastSetOfExercise: [HapticStep(.stop), HapticStep(.success, after: 300)]
        case .record: [HapticStep(.success), HapticStep(.success, after: 700)]
        case .tenSecondsLeft: [HapticStep(.retry)]
        case .countdown: [HapticStep(.click)]
        case .restOver: [HapticStep(.notification), HapticStep(.notification, after: 600), HapticStep(.start, after: 600)]
        case .restAdjusted: [HapticStep(.click)]
        case .endedOnPhone: [HapticStep(.stop), HapticStep(.directionDown, after: 500)]
        case .savedToHealth: [HapticStep(.success)]
        case .failed: [HapticStep(.failure)]
        }
    }
}

/// Seconds after the rest-over cue before it plays once more, if the screen
/// was not woken or touched in between.
public let restOverRepeatSeconds: TimeInterval = 8

/// What logging a set taps. A record replaces the others; then the last set
/// of an exercise; then a rest beginning; else the next set follows straight
/// on (a superset's partner, a warm-up's next rung, a drop).
public func cueForLoggedSet(record: Bool, lastOfExercise: Bool, rests: Bool) -> WatchCue {
    if record { return .record }
    if lastOfExercise { return .lastSetOfExercise }
    if rests { return .restBegins }
    return .partnerNext
}

/// The cues one rest plays, with when: 10 s left (only for rests of 20 s or
/// more), a click at 3, 2 and 1, and the end. The warnings only while they
/// are still to come; the end always, since a rest ends however late it is.
public func restCues(endsAt: Date, seconds: Int, now: Date) -> [(at: Date, cue: WatchCue)] {
    var cues: [(at: Date, cue: WatchCue)] = []
    if seconds >= 20 { cues.append((endsAt.addingTimeInterval(-10), .tenSecondsLeft)) }
    for left in [3.0, 2.0, 1.0] where Double(seconds) > left {
        cues.append((endsAt.addingTimeInterval(-left), .countdown))
    }
    cues = cues.filter { $0.at > now }
    cues.append((endsAt, .restOver))
    return cues
}
