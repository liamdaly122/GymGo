#if !os(macOS)
import GymGoKit
import SwiftUI

/// The set in hand: the lift, which set it is, and the weight × reps to log,
/// poster-sized. The Digital Crown moves the weight through what the gym can
/// actually load; tap the reps to put the Crown on them. Done, a double tap
/// or (later) the Action button logs exactly what is on screen.
public struct SetInHandView: View {
    let store: WatchSessionStore
    let hand: SetInHand

    @State private var weightIndex: Double = 0
    @State private var reps: Double = 0
    @State private var crownOnReps = false
    @FocusState private var focused: Bool

    public init(store: WatchSessionStore, hand: SetInHand) {
        self.store = store
        self.hand = hand
    }

    private var ladder: [Double] { hand.lift.ladder.isEmpty ? [0] : hand.lift.ladder }
    private var weight: Double { ladder[min(max(Int(weightIndex.rounded()), 0), ladder.count - 1)] }
    private var repCount: Int { max(0, Int(reps.rounded())) }
    private var ready: Bool { repCount > 0 }

    public var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(hand.lift.name)
                .font(Theme.display(17))
                .textCase(.uppercase)
                .foregroundStyle(Theme.chalk)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
            Text(hand.set.label)
                .font(Theme.text(12))
                .foregroundStyle(Theme.muted)
                .lineLimit(1)

            HStack(alignment: .firstTextBaseline, spacing: 4) {
                Text(formatWeight(weight))
                    .font(Theme.display(46, extraBold: true))
                    .foregroundStyle(crownOnReps ? Theme.chalk : Theme.hot)
                    .onTapGesture { crownOnReps = false }
                Text(hand.lift.unit)
                    .font(Theme.text(11))
                    .foregroundStyle(Theme.muted)
                Spacer(minLength: 2)
                Text("× \(repCount)")
                    .font(Theme.display(34, extraBold: true))
                    .foregroundStyle(crownOnReps ? Theme.hot : Theme.chalk)
                    .onTapGesture { crownOnReps = true }
            }
            .accessibilityElement(children: .combine)
            .accessibilityLabel("\(formatWeight(weight)) \(hand.lift.unit), \(repCount) reps")

            if let note = hand.lift.setupNote, !note.isEmpty {
                Text(note)
                    .font(Theme.text(11))
                    .foregroundStyle(Theme.muted)
                    .lineLimit(1)
            }

            Spacer(minLength: 2)

            Button {
                store.done(weight: weight, reps: repCount)
            } label: {
                Text(ready ? "Done · \(formatLogged(weight, repCount))" : "Set the reps")
                    .font(Theme.display(17))
                    .textCase(.uppercase)
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .tint(Theme.chalk)
            .foregroundStyle(Theme.ground)
            .disabled(!ready)
            #if os(watchOS)
            .handGestureShortcut(.primaryAction)
            #endif
            .accessibilityLabel(ready ? "Mark \(hand.set.label) done, \(formatWeight(weight))kg × \(repCount)" : "Set the reps first")
        }
        .focusable()
        .focused($focused)
        #if os(watchOS)
        .digitalCrownRotation(
            crownOnReps ? $reps : $weightIndex,
            from: 0,
            through: crownOnReps ? 50 : Double(ladder.count - 1),
            by: 1,
            sensitivity: .low,
            isContinuous: false,
            isHapticFeedbackEnabled: true
        )
        #endif
        .onAppear { reset() }
        .onChange(of: hand.set.id) { reset() }
    }

    /// Start at the numbers the session list and the watch's rules chose.
    private func reset() {
        let target = hand.weight ?? 0
        let index = ladder.lastIndex(where: { $0 <= target + 1e-9 }) ?? 0
        weightIndex = Double(index)
        reps = Double(hand.reps ?? 0)
        crownOnReps = false
        focused = true
    }
}
#endif
