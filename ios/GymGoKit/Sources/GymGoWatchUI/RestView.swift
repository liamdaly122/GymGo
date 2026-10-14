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
            // The clock's row: what this is, and the heart rate.
            HStack(spacing: 6) {
                Text(record == nil ? "Rest" : "New record")
                    .font(Theme.text(13, semiBold: true))
                    .textCase(.uppercase)
                    .foregroundStyle(record == nil ? Theme.muted : Theme.hot)
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
                    .layoutPriority(1)
                    .accessibilityHidden(record != nil)
                HeartRateBadge(workout: store.workout)
                Spacer(minLength: 0)
            }
            .padding(.trailing, Theme.screenWidth < 190 ? 44 : 50)

            // The last ten seconds turn blue. The schedule starts now: with
            // only the future moment in it, the first frame is drawn as of then.
            TimelineView(.explicit([Date(), rest.endsAt.addingTimeInterval(-10)].sorted())) { context in
                let closing = context.date >= rest.endsAt.addingTimeInterval(-10)
                countdown(to: rest.endsAt)
                    .font(Theme.number(record == nil ? 64 : 54))
                    .foregroundStyle(closing ? Theme.hot : Theme.chalk)
                    .monospacedDigit()
                    .multilineTextAlignment(.center)
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)
                    .accessibilityLabel("Rest")
                    .accessibilityAddTraits(.updatesFrequently)
            }

            if let record {
                Text(recordLine(record))
                    .font(Theme.text(12, semiBold: true))
                    .foregroundStyle(Theme.hot)
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
                    .accessibilityLabel("New record. \(recordLine(record))")
            }

            Button {
                store.touched()
                showSets()
            } label: {
                VStack(spacing: 0) {
                    Text("Up next · \(upNextDetail)")
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
        .focusEffectDisabled()
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

    /// The phone wrote "Set 2 of 3 · 100 × 5" before the set just done; the
    /// watch's own rules (carry forward, the back-off target) may have moved
    /// the numbers since. When the next set is the same lift, say what the
    /// set screen will actually start at.
    private var upNextDetail: String {
        guard let next = store.setInHand, next.lift.name == rest.upNext.name,
              let weight = next.weight, let reps = next.reps, reps > 0 else { return rest.upNext.detail }
        return "\(next.set.label) · \(formatLogged(weight, reps))"
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
        case .weight: "\(formatWeight(record.value))kg, was \(formatWeight(record.previous))"
        case .e1rm: "Est. max \(formatWeight((record.value * 10).rounded() / 10))kg"
        case .reps: "\(Int(record.value)) reps, was \(Int(record.previous))"
        }
    }
}
#endif
