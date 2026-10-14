import UIKit
import AVFoundation
import Capacitor
import HealthKit

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?
    /// Holds the mirroring handler below for the life of the app: a store
    /// made and dropped inside a function would take the handler with it.
    private let health = HKHealthStore()

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // The rest beep and the record tone play over whatever is already
        // playing rather than stopping it: a gym without music is worse.
        // Playback rather than ambient, so a cue sounds with the silent
        // switch on, as a timer should; the app's own Sound toggle is how
        // the cues are silenced. Audio is a nicety, so a failure here must
        // never stop the app launching.
        do {
            try AVAudioSession.sharedInstance().setCategory(.playback, mode: .default, options: [.mixWithOthers])
            try AVAudioSession.sharedInstance().setActive(true)
        } catch {
            print("GymGo: audio session not configured: \(error)")
        }
        // The Live Activity is wired before the watch link starts, so the
        // first report of a launch reaches it: a launch in the background (a
        // watch's message, a mirrored workout) never loads the web view or
        // the plugin, and the web app is frozen while the phone is locked.
        wireLiveActivity()
        // The watch link starts in native code, so the watch can reach the
        // phone while the web view is frozen.
        WatchLink.shared.start()
        return true
    }

    private func wireLiveActivity() {
        let live = LiveSessionActivities.shared
        let link = WatchLink.shared
        live.source = .init(
            lastState: { link.lastState() },
            inbox: { link.inbox() },
            lastContext: { link.lastContext() }
        )
        // WatchLink calls these on the main queue.
        link.onStateNative = { state in
            MainActor.assumeIsolated { LiveSessionActivities.shared.receive(json: state.json, receivedAt: state.receivedAt) }
        }
        link.onStartingWatchWorkout = { context in
            MainActor.assumeIsolated { LiveSessionActivities.shared.phoneStarting(context: context) }
        }
        link.onWatchWorkoutNotStarted = { context in
            MainActor.assumeIsolated { LiveSessionActivities.shared.phoneStartFailed(context: context) }
        }
        // The launch's tidy-up waits for the link: the report that woke the
        // app goes first, so a stale one on disk never ends what it feeds.
        link.onActivated = {
            MainActor.assumeIsolated { LiveSessionActivities.shared.linkActivated() }
        }
        live.begin()

        // The watch mirrors its workout session to the phone once it runs.
        // HealthKit then launches GymGo in the background, if it is not
        // running, with a one-time permission to start a Live Activity: the
        // only way one can start for a session begun on the wrist while the
        // phone is locked. HealthKit asks for this to be set promptly at every
        // launch. It is called on a background queue.
        health.workoutSessionMirroringStartHandler = { session in
            DispatchQueue.main.async {
                LiveSessionActivities.shared.mirroredSessionStarted(session)
            }
        }
    }

    func applicationWillResignActive(_ application: UIApplication) {
        // Sent when the application is about to move from active to inactive state. This can occur for certain types of temporary interruptions (such as an incoming phone call or SMS message) or when the user quits the application and it begins the transition to the background state.
        // Use this method to pause ongoing tasks, disable timers, and invalidate graphics rendering callbacks. Games should use this method to pause the game.
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
        // Use this method to release shared resources, save user data, invalidate timers, and store enough application state information to restore your application to its current state in case it is terminated later.
        // If your application supports background execution, this method is called instead of applicationWillTerminate: when the user quits.
    }

    func applicationWillEnterForeground(_ application: UIApplication) {
        // Called as part of the transition from the background to the active state; here you can undo many of the changes made on entering the background.
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        // Restart any tasks that were paused (or not yet started) while the application was inactive. If the application was previously in the background, optionally refresh the user interface.
    }

    func applicationWillTerminate(_ application: UIApplication) {
        // Called when the application is about to terminate. Save data if appropriate. See also applicationDidEnterBackground:.
    }

    func application(_ application: UIApplication,
                     configurationForConnecting connectingSceneSession: UISceneSession,
                     options: UIScene.ConnectionOptions) -> UISceneConfiguration {
        let config = UISceneConfiguration(name: "Default Configuration",
                                          sessionRole: connectingSceneSession.role)
        config.delegateClass = SceneDelegate.self
        return config
    }
}
