import Foundation

// Pause and resume, and the Action button on an Apple Watch Ultra: the rules
// the watch keeps for them, pure so the Mac tests them. The HealthKit and
// App Intents sides (`WorkoutController`, `WatchSessionStore+Action` and the
// intents in the watch target) only carry out what these decide.

/// Where the Health workout session is, as far as pausing goes.
public enum HealthSessionPhase: Sendable, Equatable {
    case running, paused
    /// Not started, stopped or ended: nothing to pause or resume.
    case other
}

/// HealthKit's `pauseOrResumeRequest`: the lifter pressed both of the
/// watch's buttons together (the Crown and the side button on any watch).
public enum PauseRequest {
    /// A request this soon after a pause or resume the app was asked for
    /// directly (an intent, or a button on the screen) is that press's echo.
    public static let echoWindow: TimeInterval = 2

    public enum Answer: Sendable, Equatable { case pause, resume }

    /// A toggle on the session's own state, never a guess at what was meant:
    /// running pauses, paused resumes. Ignored within `echoWindow` of a pause
    /// or resume asked for directly, because on an Ultra the Action and side
    /// buttons call the pause or resume intent and may raise this request
    /// too, and toggling on it would undo the press.
    public static func answer(_ phase: HealthSessionPhase, lastAsked: Date?, now: Date) -> Answer? {
        if let lastAsked, now.timeIntervalSince(lastAsked) < echoWindow { return nil }
        switch phase {
        case .running: return .pause
        case .paused: return .resume
        case .other: return nil
        }
    }
}

/// Health's active time: the workout's elapsed time with every pause left
/// out (`HKLiveWorkoutBuilder.elapsedTime`), as read at `at`. While it runs,
/// it carries on from there with the clock; while paused, it stands still.
public struct ActiveTime: Sendable, Equatable {
    public var seconds: TimeInterval
    public var at: Date
    public var running: Bool

    public init(seconds: TimeInterval, at: Date, running: Bool) {
        self.seconds = max(0, seconds)
        self.at = at
        self.running = running
    }

    /// The active time at `now`. Never before the reading, never negative.
    public func seconds(at now: Date) -> TimeInterval {
        running ? seconds + max(0, now.timeIntervalSince(at)) : seconds
    }
}

/// What a press of the Action button does mid-session: the donated "next
/// action" (`ActionButtonPress`). The first that applies:
///
/// | State | A press |
/// |---|---|
/// | Paused | resumes, whoever logs the sets |
/// | The phone logs sets | nothing |
/// | Resting | skips the rest |
/// | A set in hand | Done with the numbers on screen |
/// | Anything else | nothing |
///
/// A press never finishes a workout (Apple's guidance: a later press should
/// carry the workout on, not stop it). Paused comes first: a resume touches
/// no sets, so it cannot fight the phone, and no set logged on the phone
/// resumes Health the way one logged on the wrist does.
public enum ActionPress: Sendable, Equatable {
    case nothing, resume, skipRest, logSet

    public static func decide(phoneLogs: Bool, paused: Bool, resting: Bool, setInHand: Bool) -> ActionPress {
        if paused { return .resume }
        if phoneLogs { return .nothing }
        if resting { return .skipRest }
        if setInHand { return .logSet }
        return .nothing
    }
}

/// The Action button's first press, and Siri's "Start GymGo workout": the
/// session the phone laid out for today, and nothing else. A session not due
/// today stays a tap on Start early, so a press never trains a later day.
/// Every refusal is worded as the Today card words that state.
public enum ActionButtonStart: Sendable, Equatable {
    case start
    case refuse(String)

    public static let notDueToday = "Not due today: start it on the watch"

    public static func decide(_ card: TodayCard) -> ActionButtonStart {
        switch card.kind {
        case .ready:
            return card.startLabel == "Start" ? .start : .refuse(notDueToday)
        case .noPhone, .runningOnPhone:
            // The heading ("GymGo", "On your iPhone") only repeats the message.
            return .refuse(card.message ?? card.heading)
        case .started, .waitingForPhone, .discarded, .blockDone, .noPlan:
            return .refuse([card.heading, card.message].compactMap { $0 }.joined(separator: ". "))
        }
    }

    /// A session is on the watch but Health is not recording it, so the
    /// Action button has no workout session to run (the system wants one
    /// within 30 seconds). The session itself carries on without Health.
    public static func notRecording(_ health: WatchStateReport.Health) -> String {
        switch health {
        case .denied: "Turn on Health for GymGo. The session runs without it."
        case .unavailable: "Health is not available here. The session runs without it."
        case .off, .recording: "Health did not start recording. The session runs without it."
        }
    }
}
