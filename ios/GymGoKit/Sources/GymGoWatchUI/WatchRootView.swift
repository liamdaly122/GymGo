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
        // The system's own controls (a sheet's close button) stay raised:
        // blue on a button would blur the one signal blue carries.
        .tint(Theme.raised)
        .background(Theme.ground)
        .onChange(of: scenePhase, initial: true) { screenChanged() }
        .onChange(of: dimmed) { screenChanged() }
    }

    private func screenChanged() {
        store.screenChanged(awake: scenePhase == .active && !dimmed)
    }
}

/// "Logged · Undo" for the 5 s after a set is logged on the wrist, in the
/// place of `content`, which comes back when the window closes. Raised, not
/// chalk: it is there, but it is not the next thing to press.
struct UndoOr<Content: View>: View {
    let store: WatchSessionStore
    let height: CGFloat
    @ViewBuilder let content: () -> Content

    var body: some View {
        if let window = store.state.undo, window.until > Date() {
            // The store closes the window on time; this hides it on time
            // even if the app was held up.
            TimelineView(.explicit([Date(), window.until])) { context in
                if context.date < window.until {
                    Button {
                        store.undoLastSet()
                    } label: {
                        Text("Logged · Undo")
                            .font(Theme.display(18))
                            .textCase(.uppercase)
                            .lineLimit(1)
                            .minimumScaleFactor(0.6)
                            .frame(maxWidth: .infinity, minHeight: height)
                    }
                    .raisedButton()
                    .accessibilityLabel("Logged. Undo")
                    .accessibilityHint("Takes the set back")
                } else {
                    content()
                }
            }
        } else {
            content()
        }
    }
}

/// A countdown to `end` that never builds a backwards range once `end` has passed.
func countdown(to end: Date) -> Text {
    let now = Date()
    return Text(timerInterval: now...max(now, end), countsDown: true)
}

/// A solid button at exactly the size its label asks for: the system's
/// bordered styles pad it, and on a watch every point counts.
struct SolidButtonStyle: ButtonStyle {
    let fill: Color
    let text: Color

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .foregroundStyle(text)
            .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(fill))
            .contentShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
            .opacity(configuration.isPressed ? 0.7 : 1)
            .scaleEffect(configuration.isPressed ? 0.97 : 1)
    }
}

extension View {
    /// Chalk: the one thing to press next.
    func chalkButton() -> some View { buttonStyle(SolidButtonStyle(fill: Theme.chalk, text: Theme.ground)) }
    /// Raised: there, but not the next thing.
    func raisedButton() -> some View { buttonStyle(SolidButtonStyle(fill: Theme.raised, text: Theme.chalk)) }
}
#endif
