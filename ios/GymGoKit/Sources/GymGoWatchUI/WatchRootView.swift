#if !os(macOS)
import GymGoKit
import SwiftUI

/// What the watch shows: the rest while one runs, else the set in hand, else
/// Finish. With no session, it says where to start one.
public struct WatchRootView: View {
    @Bindable var store: WatchSessionStore
    @State private var confirmingFinish = false

    public init(store: WatchSessionStore) {
        self.store = store
    }

    public var body: some View {
        NavigationStack {
            Group {
                if let session = store.session, !session.finished {
                    if let rest = store.rest {
                        RestView(store: store, rest: rest)
                    } else if let hand = store.setInHand {
                        SetInHandView(store: store, hand: hand)
                    } else {
                        finishPrompt
                    }
                } else {
                    VStack(spacing: 6) {
                        Text("GymGo")
                            .font(Theme.display(28, extraBold: true))
                            .foregroundStyle(Theme.chalk)
                        Text("Start a session on your iPhone and it opens here.")
                            .font(Theme.text(13))
                            .foregroundStyle(Theme.muted)
                            .multilineTextAlignment(.center)
                    }
                }
            }
            .toolbar {
                if let session = store.session, !session.finished {
                    ToolbarItem(placement: .topBarLeading) {
                        NavigationLink {
                            SessionListView(session: session)
                        } label: {
                            Image(systemName: "list.bullet")
                                .foregroundStyle(Theme.chalk)
                        }
                        .tint(Theme.raised)
                        .accessibilityLabel("Show the whole session")
                    }
                    ToolbarItem(placement: .topBarTrailing) {
                        Button {
                            confirmingFinish = true
                        } label: {
                            Image(systemName: "flag.checkered")
                                .foregroundStyle(Theme.chalk)
                        }
                        .tint(Theme.raised)
                        .accessibilityLabel("Finish")
                    }
                }
            }
            .confirmationDialog("Finish this workout?", isPresented: $confirmingFinish) {
                Button("Finish and save") { store.finish() }
                Button("Keep going", role: .cancel) {}
            } message: {
                Text("It saves on your iPhone. Sets you did not log are discarded.")
            }
        }
        .tint(Theme.hot)
        .background(Theme.ground)
    }

    private var finishPrompt: some View {
        VStack(spacing: 6) {
            Text("Last set done")
                .font(Theme.text(13))
                .foregroundStyle(Theme.muted)
            Button {
                confirmingFinish = true
            } label: {
                Text("Finish")
                    .font(Theme.display(20))
                    .textCase(.uppercase)
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .tint(Theme.chalk)
            .foregroundStyle(Theme.ground)
        }
    }
}
#endif
