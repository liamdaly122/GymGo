import GymGoWatchUI
import SwiftUI

/// GymGo on the watch: a thin shell. The screens, the session and the rules
/// all live in ios/GymGoKit, where they build and test without this target.
@main
struct GymGoWatchApp: App {
    @State private var store = WatchSessionStore()

    var body: some Scene {
        WindowGroup {
            WatchRootView(store: store)
        }
    }
}
