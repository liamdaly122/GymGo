import AppIntents
import Foundation
import GymGoWatchUI
import os

// The Action button on an Apple Watch Ultra, Pause and Resume, and Siri.
//
// These live in the watch app target, never in GymGoKit or an extension:
// Apple only offers the Action button an app's own intents ("don't implement
// them in an AppIntentsExtension"). Each intent makes one call into the
// store, which decides what it means (GymGoKit's Pause.swift).
//
// Isolation: the target defaults to the main actor, but types conforming to
// AppIntent, AppEnum and AppShortcutsProvider are inferred nonisolated, so
// the declarations stay plain. `nonisolated struct` would refuse the
// `@Parameter var`. Each `perform()` hops to the main actor for its call.

nonisolated private let log = Logger(subsystem: "com.liamdaly.gymgo.watchkitapp", category: "ActionButton")

// MARK: - What the Action button can start

/// The one kind of workout GymGo starts from the Action button: the session
/// the phone laid out for today. Settings > Action Button > Workout > GymGo >
/// First Press lists it beside Open App. Choose it: Open App only opens.
enum GymGoWorkoutStyle: String, AppEnum {
    case today

    static let typeDisplayRepresentation: TypeDisplayRepresentation = "Session"
    static let caseDisplayRepresentations: [GymGoWorkoutStyle: DisplayRepresentation] = [
        .today: DisplayRepresentation(title: "Today's Session", subtitle: "From your plan"),
    ]
}

/// Why a start was refused, as the system shows it. The store words it as
/// the Today card words the same state.
struct StartRefusal: Error, CustomLocalizedStringResourceConvertible {
    let reason: String

    var localizedStringResource: LocalizedStringResource {
        LocalizedStringResource(stringLiteral: reason)
    }
}

// MARK: - The first press, and Siri: start today's session

/// Puts GymGo under Settings > Action Button (Action: Workout, App: GymGo),
/// and is what Siri runs. The system opens the app before `perform()` (the
/// protocol's own `openAppWhenRun`: leave it), and wants a workout session
/// running within 30 seconds. `workoutStyle` must be a `@Parameter`, or
/// Settings offers only Open App.
struct StartGymGoWorkout: StartWorkoutIntent {
    static let title: LocalizedStringResource = "Start Workout"
    static let description = IntentDescription("Starts today's GymGo session on your watch and records it to Apple Health.")

    static let suggestedWorkouts: [StartGymGoWorkout] = [StartGymGoWorkout(style: .today)]

    @Parameter(title: "Session")
    var workoutStyle: GymGoWorkoutStyle

    init() {
        workoutStyle = .today
    }

    var displayRepresentation: DisplayRepresentation {
        GymGoWorkoutStyle.caseDisplayRepresentations[workoutStyle] ?? DisplayRepresentation(title: "Today's Session")
    }

    func perform() async throws -> some IntentResult {
        do {
            try await WatchApp.shared.store.startFromActionButton()
        } catch let refusal as ActionButtonRefusal {
            log.info("Start refused: \(refusal.reason, privacy: .public)")
            throw StartRefusal(reason: refusal.reason)
        }
        // The next action is donated when the recording starts, however it
        // started; naming it here too covers a donation the system lost.
        return .result(actionButtonIntent: ActionButtonPress())
    }
}

// MARK: - Every later press while the workout runs: the next action

/// The Action button's "next action": every press while GymGo's Health
/// workout runs comes here. What it does is decided at press time
/// (`WatchSessionStore.actionButtonPressed()`): resume a pause, skip a rest,
/// log the set in hand with the numbers on screen, or nothing. Never Finish.
struct ActionButtonPress: AppIntent {
    static let title: LocalizedStringResource = "Log Set"
    static let description = IntentDescription("Logs the set in hand, skips a rest, or resumes a paused workout.")

    func perform() async throws -> some IntentResult {
        let press = await WatchApp.shared.store.actionButtonPressed()
        log.info("Action button press: \(String(describing: press), privacy: .public)")
        return .result()
    }
}

/// Makes a press the next action for the Health workout that has just
/// begun recording. Only the latest donation counts. From
/// `WorkoutController.onRecordingStarted`, so a start on the wrist, from the
/// phone, from the Action button and a recovery all get one. A failed
/// donation is logged: the press then does nothing, and the session runs on.
enum ActionButtonDonation {
    static func donateNextAction() {
        Task {
            do {
                try await StartGymGoWorkout().donate(result: .result(actionButtonIntent: ActionButtonPress()))
            } catch {
                log.error("Next-action donation failed: \(String(describing: error), privacy: .public)")
            }
        }
    }
}

// MARK: - The Action and side buttons together: pause and resume

/// Without these the system ignores the two-button press.
struct PauseGymGoWorkout: PauseWorkoutIntent {
    static let title: LocalizedStringResource = "Pause Workout"

    func perform() async throws -> some IntentResult {
        await WatchApp.shared.store.pauseWorkout()
        return .result()
    }
}

struct ResumeGymGoWorkout: ResumeWorkoutIntent {
    static let title: LocalizedStringResource = "Resume Workout"

    func perform() async throws -> some IntentResult {
        await WatchApp.shared.store.resumeWorkout()
        return .result()
    }
}

// MARK: - Siri

/// "Start GymGo workout" on the watch: the same path as the first press.
/// Every phrase must hold the app's name.
struct GymGoShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: StartGymGoWorkout(),
            phrases: [
                "Start \(.applicationName) workout",
                "Start a workout in \(.applicationName)",
                "Start my \(.applicationName) session",
            ],
            shortTitle: "Start Workout",
            systemImageName: "figure.strengthtraining.traditional"
        )
    }
}
