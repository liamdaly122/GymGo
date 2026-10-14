import Foundation
import GymGoKit

/// Why the Action button's first press (or Siri's "Start GymGo workout")
/// did not start a workout. The watch target's intent hands `reason` to the
/// system, which shows it; the app stays open where it was.
public struct ActionButtonRefusal: Error, Sendable, Equatable {
    public let reason: String

    public init(_ reason: String) {
        self.reason = reason
    }
}

/// The Action button on an Apple Watch Ultra, and Pause and Resume, as the
/// store carries them out. The intents themselves live in the watch app
/// target (Apple only offers the Action button an app's own intents); they
/// call in here. What each press means is decided by GymGoKit's pure rules
/// (`ActionButtonStart`, `ActionPress`).
extension WatchSessionStore {
    /// The longest the first press waits for Health to record. The system
    /// gives a start intent 30 seconds to have a workout session running.
    public nonisolated static let actionButtonWait: TimeInterval = 25

    /// The first press: today's session, if it is due today, recording to
    /// Health. Never asks for Health permission: a sheet would wait on the
    /// lifter past the system's 30 seconds. Throws, worded as the Today card
    /// words it, when there is nothing it may start, and when Health is not
    /// recording once the wait is over (the session itself carries on).
    public func startFromActionButton(waitingUpTo seconds: TimeInterval = WatchSessionStore.actionButtonWait) async throws {
        workout.holdHealthPrompts(for: seconds + 5)
        workout.refreshAuthorization()
        if state.session != nil {
            // Already on the wrist (a relaunch, or Health refused it before):
            // make sure Health records it. The phone's start does exactly
            // this, on the store's Health queue, without asking.
            if workout.isRunning { return }
            phoneStartedWorkout()
        } else {
            switch ActionButtonStart.decide(todayCard) {
            case .refuse(let reason):
                throw ActionButtonRefusal(reason)
            case .start:
                // The same path as the Start button.
                startToday()
                guard state.session != nil else {
                    if case .refuse(let reason) = ActionButtonStart.decide(todayCard) { throw ActionButtonRefusal(reason) }
                    throw ActionButtonRefusal("Open GymGo on the watch to start today's session.")
                }
            }
        }
        guard await waitForRecording(upTo: seconds) else {
            throw ActionButtonRefusal(ActionButtonStart.notRecording(workout.health))
        }
    }

    /// Waits for the Health workout to be running, and no longer than
    /// `seconds`. Gives up at once when Health is refused or unavailable:
    /// the start returns straight away then, and nothing will change.
    private func waitForRecording(upTo seconds: TimeInterval) async -> Bool {
        let deadline = Date().addingTimeInterval(seconds)
        while !workout.isRunning, Date() < deadline {
            if workout.authorization == .denied || workout.authorization == .unavailable { break }
            try? await Task.sleep(for: .milliseconds(250))
        }
        return workout.isRunning
    }

    /// A press while the session runs: the donated next action. Paused →
    /// resume, whoever logs; the phone logging → nothing; resting → skip
    /// the rest; a set in hand → Done with the numbers on screen, or the
    /// failure tap when that has no reps yet (the screen would ask for them;
    /// a press never logs 0 × 0; `logSetOnScreen` plays the tap, once);
    /// anything else → nothing. A press never finishes a workout.
    @discardableResult
    public func actionButtonPressed() -> ActionPress {
        let press = ActionPress.decide(
            phoneLogs: state.owner == .phone, paused: workout.isPaused,
            resting: state.rest != nil, setInHand: setInHand != nil
        )
        switch press {
        case .nothing:
            break
        case .resume:
            resumeWorkout()
        case .skipRest:
            skipRest()
        case .logSet:
            logSetOnScreen()
        }
        return press
    }

    /// Pause: the pause intent (the Action and side buttons together), or
    /// Pause on the metrics or controls page. The rest keeps its wall-clock
    /// end; while paused, its rest-over notification is on. Asked for on
    /// the wrist, so it taps (`.paused`): wrist-down that is the only sign
    /// it worked. Only a recording that runs pauses, so only that taps.
    public func pauseWorkout() {
        touched()
        let pauses = workout.isRunning && !workout.isPaused
        // Asked for now: a resume a logged set held back is overtaken.
        resumeAfterUndo = nil
        workout.pause()
        if pauses { haptics.play(.paused) }
        syncRestAlert()
    }

    /// Resume: the resume intent, a press while paused, or Resume on screen.
    /// Asked for on the wrist, so it taps (`.resumed`). The resume a logged
    /// set causes is not this: the set's own cue says that.
    public func resumeWorkout() {
        touched()
        let resumes = workout.isPaused
        resumeAfterUndo = nil
        workout.resume()
        if resumes { haptics.play(.resumed) }
        syncRestAlert()
    }

    /// Both of the watch's buttons together paused or resumed the Health
    /// workout (`WorkoutController.onButtonsPausedOrResumed`): asked for on
    /// the wrist, so it taps, as Pause and Resume do.
    func buttonsPausedOrResumed(_ answer: PauseRequest.Answer) {
        touched()
        resumeAfterUndo = nil
        haptics.play(answer == .pause ? .paused : .resumed)
    }

    /// The Health session paused or resumed, however it came about
    /// (`WorkoutController.onPauseChanged`, wired in the watch target): the
    /// rest-over notification follows, and the phone hears of it now, once.
    /// `syncRestAlert` reports, since the report's `paused` changed; another
    /// report here would wake the phone twice for one pause. No cue: this
    /// also runs for a recovery and for the resume a logged set causes; the
    /// cues are played where the lifter asked.
    public func workoutPauseChanged() {
        syncRestAlert()
    }
}
