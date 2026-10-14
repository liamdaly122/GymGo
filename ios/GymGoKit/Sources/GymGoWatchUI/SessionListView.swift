#if os(watchOS)
import GymGoKit
import SwiftUI

/// Every station in order, how far along each is, and where you are, in blue.
struct SessionListView: View {
    let store: WatchSessionStore

    var body: some View {
        if let session = store.session {
            let current = store.setInHand?.set.station
            List {
                ForEach(Array(session.snapshot.stations.enumerated()), id: \.offset) { index, station in
                    let progress = session.progress(ofStation: index)
                    let finished = progress.done >= progress.total && progress.total > 0
                    HStack(alignment: .top, spacing: 4) {
                        VStack(alignment: .leading, spacing: 0) {
                            Text(station.name)
                                .font(Theme.display(15))
                                .textCase(.uppercase)
                                .foregroundStyle(index == current ? Theme.hot : (finished ? Theme.muted : Theme.chalk))
                                .lineLimit(2)
                            Text("\(station.outline) · \(progress.done)/\(progress.total)")
                                .font(Theme.text(11))
                                .foregroundStyle(Theme.muted)
                                .lineLimit(1)
                        }
                        Spacer(minLength: 0)
                        if finished {
                            Image(systemName: "checkmark")
                                .font(.system(size: 11, weight: .bold))
                                .foregroundStyle(Theme.muted)
                        }
                    }
                    .listRowBackground(Color.clear)
                    .accessibilityElement(children: .ignore)
                    .accessibilityLabel(
                        "\(station.name), \(progress.done) of \(progress.total) sets done"
                            + (index == current ? ", now" : finished ? ", done" : "")
                    )
                }
            }
            .listStyle(.plain)
            .navigationTitle("This session")
        }
    }
}
#endif
