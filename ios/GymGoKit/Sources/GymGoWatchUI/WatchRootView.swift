#if os(watchOS)
import GymGoKit
import SwiftUI

/// The watch app's one screen: the summary of a session just ended; else
/// the workout, as horizontal pages like Apple's Workout app; else, with
/// nothing running, today's session and the week as vertical pages.
public struct WatchRootView: View {
    let store: WatchSessionStore
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.isLuminanceReduced) private var dimmed

    public init(store: WatchSessionStore) {
        self.store = store
    }

    public var body: some View {
        Group {
            if let summary = store.state.summary {
                SummaryView(store: store, summary: summary)
            } else if store.session != nil {
                WorkoutPages(store: store)
            } else {
                IdlePages(store: store)
            }
        }
        .tint(Theme.hot)
        .background(Theme.ground)
        .onChange(of: scenePhase, initial: true) { screenChanged() }
        .onChange(of: dimmed) { screenChanged() }
    }

    private func screenChanged() {
        store.screenChanged(awake: scenePhase == .active && !dimmed)
    }
}

/// A countdown to `end` that never builds a backwards range once `end` has passed.
func countdown(to end: Date) -> Text {
    let now = Date()
    return Text(timerInterval: now...max(now, end), countsDown: true)
}

/// A chalk button: the one thing to press next.
struct ChalkButtonStyle: ViewModifier {
    func body(content: Content) -> some View {
        content
            .buttonStyle(.borderedProminent)
            .buttonBorderShape(.roundedRectangle(radius: 14))
            .tint(Theme.chalk)
            .foregroundStyle(Theme.ground)
    }
}

/// A raised button: there, but not the next thing.
struct RaisedButtonStyle: ViewModifier {
    func body(content: Content) -> some View {
        content
            .buttonStyle(.borderedProminent)
            .buttonBorderShape(.roundedRectangle(radius: 14))
            .tint(Theme.raised)
            .foregroundStyle(Theme.chalk)
    }
}

extension View {
    func chalkButton() -> some View { modifier(ChalkButtonStyle()) }
    func raisedButton() -> some View { modifier(RaisedButtonStyle()) }
}
#endif
