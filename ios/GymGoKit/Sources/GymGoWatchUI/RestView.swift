#if !os(macOS)
import GymGoKit
import SwiftUI

/// The rest: the clock counting down by itself, what is next, and a record in
/// blue when the set just done was one. The watch counts down on its own, so
/// this works with the phone locked in a bag; one tap on the wrist ends it.
public struct RestView: View {
    let store: WatchSessionStore
    let rest: WatchSessionStore.Rest

    public init(store: WatchSessionStore, rest: WatchSessionStore.Rest) {
        self.store = store
        self.rest = rest
    }

    public var body: some View {
        VStack(spacing: 2) {
            if let record = store.lastRecord {
                Text(recordLine(record))
                    .font(Theme.text(12, semiBold: true))
                    .foregroundStyle(Theme.hot)
                    .lineLimit(1)
                    .accessibilityLabel("New record. \(recordLine(record))")
            } else {
                Text("Rest")
                    .font(Theme.text(12))
                    .textCase(.uppercase)
                    .foregroundStyle(Theme.muted)
            }

            Text(timerInterval: Date()...rest.endsAt, countsDown: true)
                .font(Theme.display(store.lastRecord == nil ? 54 : 46, extraBold: true))
                .foregroundStyle(Theme.chalk)
                .monospacedDigit()
                .multilineTextAlignment(.center)
                .accessibilityAddTraits(.updatesFrequently)

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
            }

            Spacer(minLength: 2)

            HStack(spacing: 6) {
                Button("+30s") { store.adjustRest(by: 30) }
                    .font(Theme.display(17))
                    .tint(Theme.raised)
                Button("Skip") { store.skipRest() }
                    .font(Theme.display(17))
                    .textCase(.uppercase)
                    .tint(Theme.chalk)
                    .foregroundStyle(Theme.ground)
                    #if os(watchOS)
                    .handGestureShortcut(.primaryAction)
                    #endif
                    .accessibilityLabel("Skip rest")
            }
            .buttonStyle(.borderedProminent)
        }
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
