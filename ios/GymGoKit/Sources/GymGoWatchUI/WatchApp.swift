import Foundation
import GymGoKit
#if os(watchOS)
import WatchConnectivity
import WatchKit
#endif

/// The watch app, put together once: the store, the HealthKit workout and
/// the link with the phone. The watch target's app delegate calls in here,
/// because watchOS can hand the app a workout to start or recover before
/// any screen exists.
@MainActor
public final class WatchApp {
    public static let shared = WatchApp()

    public let store: WatchSessionStore
    #if os(watchOS)
    private let link: PhoneLink
    #endif

    private init() {
        store = WatchSessionStore(workout: .shared)
        #if os(watchOS)
        link = PhoneLink(store: store)
        #endif
    }

    /// Makes sure everything is up: the link starts listening at launch.
    public func didFinishLaunching() {
        _ = store
    }

    public func didBecomeActive() {
        store.appBecameActive()
    }

    public func willResignActive() {
        store.screenChanged(awake: false)
    }

    /// `WKApplicationDelegate.handle(_ workoutConfiguration:)`: the phone
    /// started a workout and opened this app for it. The context naming the
    /// workout arrives separately.
    public func handleWorkoutConfiguration() {
        store.phoneStartedWorkout()
    }

    /// `WKApplicationDelegate.handleActiveWorkoutRecovery()`.
    public func handleActiveWorkoutRecovery() {
        store.recoverWorkout()
    }

    #if os(watchOS)
    /// Background refreshes: a WatchConnectivity wake is held open until its
    /// data has been delivered, then everything is marked done.
    public func handle(_ backgroundTasks: Set<WKRefreshBackgroundTask>) {
        for task in backgroundTasks {
            if let connectivity = task as? WKWatchConnectivityRefreshBackgroundTask {
                Task { @MainActor in
                    for _ in 0..<20 where WCSession.default.hasContentPending {
                        try? await Task.sleep(for: .milliseconds(250))
                    }
                    connectivity.setTaskCompletedWithSnapshot(false)
                }
            } else {
                task.setTaskCompletedWithSnapshot(false)
            }
        }
    }
    #endif
}
