#if os(watchOS)
import GymGoKit
import SwiftUI

/// "Done.": what the session came to, and whether Health has it. Headed
/// "Finished on iPhone" when the phone finished it.
struct SummaryView: View {
    let store: WatchSessionStore
    let summary: WatchSummary

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 4) {
                if summary.how == .finishedOnPhone {
                    Text("Finished on iPhone")
                        .font(Theme.text(12, semiBold: true))
                        .textCase(.uppercase)
                        .foregroundStyle(Theme.muted)
                }
                Text("Done.")
                    .font(Theme.display(40, extraBold: true))
                    .textCase(.uppercase)
                    .foregroundStyle(Theme.chalk)
                    .accessibilityAddTraits(.isHeader)
                Text(summary.title)
                    .font(Theme.display(17))
                    .textCase(.uppercase)
                    .foregroundStyle(Theme.muted)
                    .lineLimit(2)

                figure(formatElapsed(summary.duration), "Time")
                figure(summary.averageHeartRate.map { String(Int($0.rounded())) } ?? "--", "Avg BPM")
                figure(summary.activeKcal.map { String(Int($0.rounded())) } ?? "--", "Active kcal")
                figure("\(summary.setsDone) of \(summary.setsTotal)", "Sets")
                if summary.records > 0 {
                    Text(summary.records == 1 ? "1 new record" : "\(summary.records) new records")
                        .font(Theme.text(14, semiBold: true))
                        .foregroundStyle(Theme.hot)
                }
                Text(healthLine)
                    .font(Theme.text(12))
                    .foregroundStyle(summary.health == .saved ? Theme.chalk : Theme.muted)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.top, 2)

                Button {
                    store.closeSummary()
                } label: {
                    Text("Done")
                        .font(Theme.display(20, extraBold: true))
                        .textCase(.uppercase)
                        .frame(maxWidth: .infinity, minHeight: 44)
                }
                .chalkButton()
                .handGestureShortcut(.primaryAction)
                .padding(.top, 4)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .background(Theme.ground)
    }

    private func figure(_ value: String, _ label: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 4) {
            Text(value)
                .font(Theme.number(26))
                .foregroundStyle(Theme.chalk)
                .monospacedDigit()
            Text(label.uppercased())
                .font(Theme.text(11, semiBold: true))
                .foregroundStyle(Theme.muted)
        }
        .accessibilityElement(children: .combine)
    }

    private var healthLine: String {
        switch summary.health {
        case .saving: return "Saving to Health…"
        case .saved: return "Saved to Health"
        case .notSaved: return "Not saved to Health. Your sets are safe on iPhone."
        case .off:
            switch store.workout.authorization {
            case .denied: return "Health is off for GymGo. Your sets are safe on iPhone."
            case .unavailable: return "Health is not available here. Your sets are safe on iPhone."
            default: return "Not recorded in Health. Your sets are safe on iPhone."
            }
        }
    }
}
#endif
