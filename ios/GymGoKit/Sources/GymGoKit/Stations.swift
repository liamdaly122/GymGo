import Foundation

// Rules 4 and 5 of the watch's own (docs/watch-protocol.md, "The watch's own
// rules"): where the session goes after a station, and how Up next words the
// set that follows. The list says both for the order the phone walks; the
// watch needs them once a station tapped or a set skipped on the wrist takes
// it off that order. Each is a port of one TypeScript function, held to it by
// fixtures/watch/stations.json and upnext.json.

// MARK: - Rule 4: where the session goes

/// `nextStation` in `src/domain/supersets.ts`: the next station after `from`
/// with work left, going round to one skipped earlier. Nil when no other
/// station has any.
public func nextStation(_ open: [Bool], from: Int) -> Int? {
    let count = open.count
    guard count > 1 else { return nil }
    for step in 1..<count {
        let index = ((from + step) % count + count) % count
        if open[index] { return index }
    }
    return nil
}

// MARK: - Rule 5: how Up next words the set that follows

/// `WATCH_FINISH`: what follows the last set.
public let watchFinish = UpNext(name: "Finish", detail: "Last set done")

/// `UpNextSet` in `src/domain/watch.ts`: the set that comes up next, as much
/// of it as Up next reads.
public struct UpNextSet: Sendable, Equatable {
    /// Index into the stations.
    public var station: Int
    /// The lift's name.
    public var name: String
    /// "Set 3 of 4", "Warm-up 1 of 3".
    public var label: String
    /// The numbers it starts at, once the watch's own rules have had their say.
    public var weight: Double?
    public var reps: Int?

    public init(station: Int, name: String, label: String, weight: Double?, reps: Int?) {
        self.station = station
        self.name = name
        self.label = label
        self.weight = weight
        self.reps = reps
    }
}

/// `upNextFor` in `src/domain/watch.ts`: what the rest says is next, after a
/// set at station `fromStation`.
///
/// - The same station: the lift's name, and its label with the numbers it
///   starts at, "BW" for unloaded bodyweight work ("Set 3 of 4 · 100 × 5"),
///   with no numbers until it has reps above zero.
/// - Another station: its name and outline.
/// - Nothing left: Finish.
public func upNextFor(fromStation: Int, next: UpNextSet?, stations: [WatchStation]) -> UpNext {
    guard let next else { return watchFinish }
    if next.station == fromStation {
        var detail = next.label
        if let weight = next.weight, let reps = next.reps, reps > 0 {
            detail += " · \(formatLogged(weight, reps))"
        }
        return UpNext(name: next.name, detail: detail)
    }
    guard stations.indices.contains(next.station) else { return UpNext(name: next.name, detail: next.label) }
    let station = stations[next.station]
    return UpNext(name: station.name, detail: station.outline)
}

// MARK: - Numbers, worded

/// A weight the way the big fields show it: no trailing zeros, no float
/// dust. `formatNumber` in `src/domain/watch.ts`.
public func formatWeight(_ weight: Double) -> String {
    let rounded = (weight * 100).rounded() / 100
    return rounded == rounded.rounded() ? String(Int(rounded)) : String(rounded)
}

/// "102.5 × 6", or "BW × 12" for unloaded bodyweight work.
public func formatLogged(_ weight: Double, _ reps: Int) -> String {
    "\(weight > 0 ? formatWeight(weight) : "BW") × \(reps)"
}
