import AppIntents
import GymGoWatchUI
import HealthKit
import SwiftUI
import WatchKit

/// GymGo on the watch: a thin shell. The screens, the session, the rules,
/// the HealthKit workout and the link with the phone all live in
/// ios/GymGoKit, where they build and test without this target.
@main
struct GymGoWatchApp: App {
    @WKApplicationDelegateAdaptor(GymGoAppDelegate.self) private var appDelegate

    /// The hooks GymGoWatchUI cannot set itself, because the intents live in
    /// this target. Set before anything can start or recover a workout.
    init() {
        let workout = WorkoutController.shared
        // Every Health recording, however it started, makes a press of the
        // Action button the next action (log the set, skip the rest, resume).
        workout.onRecordingStarted = { ActionButtonDonation.donateNextAction() }
        // A pause or resume from any source: the rest-over notification and
        // the phone follow.
        workout.onPauseChanged = { WatchApp.shared.store.workoutPauseChanged() }
        // Only phrases with parameters need it; with one fixed phrase set it
        // just registers them.
        GymGoShortcuts.updateAppShortcutParameters()
    }

    var body: some Scene {
        WindowGroup {
            WatchRootView(store: WatchApp.shared.store)
        }
    }
}

/// What watchOS tells the app directly. A workout handed over by the phone,
/// or recovered after a crash, can arrive before any screen exists.
final class GymGoAppDelegate: NSObject, WKApplicationDelegate {
    func applicationDidFinishLaunching() {
        WatchApp.shared.didFinishLaunching()
    }

    func applicationDidBecomeActive() {
        WatchApp.shared.didBecomeActive()
    }

    func applicationWillResignActive() {
        WatchApp.shared.willResignActive()
    }

    /// The phone started a workout (`startWatchApp(toHandle:)`): the one
    /// place a watch app may start a workout session from the background.
    /// The workout it is for arrives separately, in the phone's context.
    func handle(_ workoutConfiguration: HKWorkoutConfiguration) {
        WatchApp.shared.handleWorkoutConfiguration()
    }

    /// The app crashed mid-workout and watchOS relaunched it.
    func handleActiveWorkoutRecovery() {
        WatchApp.shared.handleActiveWorkoutRecovery()
    }

    func handle(_ backgroundTasks: Set<WKRefreshBackgroundTask>) {
        WatchApp.shared.handle(backgroundTasks)
    }
}
