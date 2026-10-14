#if !os(macOS)
import GymGoKit
import SwiftUI

/// Every station in order, how far along each is, and where you are, in blue.
public struct SessionListView: View {
    let session: WatchSession

    public init(session: WatchSession) {
        self.session = session
    }

    public var body: some View {
        let current = session.setInHand?.set.station
        List {
            ForEach(Array(session.snapshot.stations.enumerated()), id: \.offset) { index, station in
                let left = session.remainingSets.filter { $0.station == index }.count
                VStack(alignment: .leading, spacing: 0) {
                    Text(station.name)
                        .font(Theme.display(15))
                        .textCase(.uppercase)
                        .foregroundStyle(index == current ? Theme.hot : (left == 0 ? Theme.muted : Theme.chalk))
                        .lineLimit(2)
                    Text(left == 0 ? "Done" : "\(station.outline) · \(left) left")
                        .font(Theme.text(11))
                        .foregroundStyle(Theme.muted)
                        .lineLimit(1)
                }
                .accessibilityElement(children: .combine)
                .accessibilityValue(index == current ? "Now" : (left == 0 ? "Done" : "\(left) sets left"))
            }
        }
        .navigationTitle("This session")
    }
}
#endif
