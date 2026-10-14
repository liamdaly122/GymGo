#if os(watchOS)
import GymGoKit
import SwiftUI

/// Every station in order, how far along each is, and where you are, in
/// blue. Tap one to go there: the set in hand moves to it, and a station
/// whose only sets left were skipped gets them back. A finished station is
/// not somewhere to go.
struct SessionListView: View {
    let store: WatchSessionStore

    var body: some View {
        if let session = store.session {
            let current = store.setInHand?.set.station
            List {
                ForEach(Array(session.snapshot.stations.enumerated()), id: \.offset) { index, station in
                    let progress = session.stationProgress(index)
                    let comesBack = progress.left == 0 && progress.skipped > 0
                    Button {
                        store.go(toStation: index)
                    } label: {
                        HStack(alignment: .top, spacing: 4) {
                            VStack(alignment: .leading, spacing: 0) {
                                Text(station.name)
                                    .font(Theme.display(15))
                                    .textCase(.uppercase)
                                    .foregroundStyle(index == current ? Theme.hot : (progress.finished ? Theme.muted : Theme.chalk))
                                    .lineLimit(2)
                                Text(session.stationLine(index))
                                    .font(Theme.text(11))
                                    .foregroundStyle(Theme.muted)
                                    .lineLimit(1)
                                    .minimumScaleFactor(0.8)
                            }
                            Spacer(minLength: 0)
                            if progress.finished {
                                Image(systemName: "checkmark")
                                    .font(.system(size: 11, weight: .bold))
                                    .foregroundStyle(Theme.muted)
                            } else if comesBack {
                                // Skipped, all of what is left: a tap brings it back.
                                Image(systemName: "arrow.uturn.backward")
                                    .font(.system(size: 11, weight: .bold))
                                    .foregroundStyle(Theme.muted)
                            }
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .contentShape(.rect)
                    }
                    .buttonStyle(.plain)
                    .disabled(progress.finished)
                    .listRowBackground(Color.clear)
                    .accessibilityElement(children: .ignore)
                    .accessibilityLabel(
                        "\(station.name), \(progress.done) of \(progress.total) sets done"
                            + (progress.skipped > 0 ? ", \(progress.skipped) skipped" : "")
                            + (index == current ? ", now" : progress.finished ? ", done" : "")
                    )
                    .accessibilityAddTraits(progress.finished ? [] : .isButton)
                    .accessibilityHint(progress.finished || index == current ? "" : (comesBack ? "Brings back the skipped sets" : "Goes to this exercise"))
                }
            }
            .listStyle(.plain)
            .navigationTitle("This session")
        }
    }
}
#endif
