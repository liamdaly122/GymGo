#if os(watchOS)
import GymGoKit
import SwiftUI

/// The rest: the clock counting down by itself, what is next, and a record
/// in blue when the set just done was one. The watch counts down on its own,
/// so this works with the phone locked in a bag. Turning the Crown or tapping
/// "Up next" folds it into a blue countdown on the set screen, so the next
/// set can be dialled in while resting. Wrist-down it keeps only the clock.
struct RestView: View {
    let store: WatchSessionStore
    let rest: RestState
    let showSets: () -> Void

    @Environment(\.isLuminanceReduced) private var dimmed
    @State private var crown = 0.0
    @FocusState private var focused: Bool

    var body: some View {
        let record = store.state.lastRecord
        VStack(spacing: 2) {
            if let record {
                Text(recordLine(record))
                    .font(Theme.text(12, semiBold: true))
                    .foregroundStyle(Theme.hot)
                    .lineLimit(2)
                    .multilineTextAlignment(.center)
                    .accessibilityLabel("New record. \(recordLine(record))")
            } else {
                Text("Rest")
                    .font(Theme.text(12, semiBold: true))
                    .textCase(.uppercase)
                    .foregroundStyle(Theme.muted)
            }

            // The last ten seconds turn blue.
            TimelineView(.explicit([rest.endsAt.addingTimeInterval(-10)])) { context in
                let closing = context.date >= rest.endsAt.addingTimeInterval(-10)
                countdown(to: rest.endsAt)
                    .font(Theme.number(record == nil ? 60 : 50))
                    .foregroundStyle(closing ? Theme.hot : Theme.chalk)
                    .monospacedDigit()
                    .multilineTextAlignment(.center)
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)
                    .accessibilityLabel("Rest")
                    .accessibilityAddTraits(.updatesFrequently)
            }

            Button {
                store.touched()
                showSets()
            } label: {
                VStack(spacing: 0) {
                    Text("Up next · \(rest.upNext.detail)")
                        .font(Theme.text(11))
                        .foregroundStyle(Theme.muted)
                        .lineLimit(1)
                    Text(rest.upNext.name)
                        .font(Theme.display(16))
                        .textCase(.uppercase)
                        .foregroundStyle(Theme.chalk)
                        .lineLimit(1)
                    if let note = nextSetupNote {
                        Text(note)
                            .font(Theme.text(11))
                            .foregroundStyle(Theme.muted)
                            .lineLimit(1)
                    }
                }
                .frame(maxWidth: .infinity)
            }
            .buttonStyle(.plain)
            .accessibilityHint("Shows the next set")

            Spacer(minLength: 2)

            if !dimmed {
                HStack(spacing: 6) {
                    Button {
                        store.addRest()
                    } label: {
                        Text("+30s")
                            .font(Theme.display(18))
                            .frame(maxWidth: .infinity, minHeight: 40)
                    }
                    .raisedButton()
                    .accessibilityLabel("Add 30 seconds")

                    Button {
                        store.skipRest()
                    } label: {
                        Text("Skip")
                            .font(Theme.display(18, extraBold: true))
                            .textCase(.uppercase)
                            .frame(maxWidth: .infinity, minHeight: 40)
                    }
                    .chalkButton()
                    .handGestureShortcut(.primaryAction)
                    .accessibilityLabel("Skip rest")
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .focusable()
        .focused($focused)
        .digitalCrownRotation($crown, from: -1000, through: 1000, by: 1, sensitivity: .low, isContinuous: true, isHapticFeedbackEnabled: false)
        .onChange(of: crown) {
            guard abs(crown) >= 1, !dimmed else { return }
            store.touched()
            showSets()
        }
        .onAppear {
            crown = 0
            focused = true
        }
    }

    /// The next lift's setup note, when the rest leads to a new station.
    private var nextSetupNote: String? {
        guard let next = store.setInHand,
              rest.upNext.name == next.station.name, rest.upNext.detail == next.station.outline,
              let note = next.lift.setupNote, !note.isEmpty else { return nil }
        return note
    }

    private func recordLine(_ record: SetRecord) -> String {
        switch record.kind {
        case .weight: "New record · \(formatWeight(record.value))kg, was \(formatWeight(record.previous))"
        case .e1rm: "New record · est. max \(formatWeight((record.value * 10).rounded() / 10))kg"
        case .reps: "New record · \(Int(record.value)) reps, was \(Int(record.previous))"
        }
    }
}
#endif
