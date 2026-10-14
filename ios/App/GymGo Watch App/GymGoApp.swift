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
