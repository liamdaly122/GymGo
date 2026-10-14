import GymGoWatchUI
import SwiftUI

/// GymGo on the watch: a thin shell. The screens, the session, the rules and
/// the link with the phone all live in ios/GymGoKit, where they build and
/// test without this target.
@main
struct GymGoWatchApp: App {
    @State private var store: WatchSessionStore
    private let link: PhoneLink

    init() {
        let store = WatchSessionStore()
        _store = State(initialValue: store)
        link = PhoneLink(store: store)
    }

    var body: some Scene {
        WindowGroup {
            WatchRootView(store: store)
        }
    }
}
