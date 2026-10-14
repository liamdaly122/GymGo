import Foundation

// What the watch's workout screens say, worded here where it is tested.
// GymGoWatchUI lays it out; nothing here knows about views.

extension WatchSession {
    /// The Finish confirmation: "14 of 18 logged · 2 skipped; sets not
    /// logged are dropped.", or "Every set is logged." A skipped set is
    /// neither logged nor left, and is dropped like any set not logged.
    public var finishMessage: String {
        let progress = progress
        guard progress.done < progress.total else { return "Every set is logged." }
        let skipped = skippedSets.count
        return "\(progress.done) of \(progress.total) logged\(skipped > 0 ? " · \(skipped) skipped" : ""); sets not logged are dropped."
    }

    /// The heading where the set in hand goes once nothing is left to log:
    /// "All sets logged", or "Nothing left · 2 skipped" when what is left
    /// was skipped.
    public var nothingLeftTitle: String {
        let skipped = skippedSets.count
        return skipped > 0 ? "Nothing left · \(skipped) skipped" : "All sets logged"
    }

    /// A station's row on This session: "Barbell · 3 × 5 · 1/3", with
    /// "· 2 skipped" when sets of it were skipped.
    public func stationLine(_ index: Int) -> String {
        guard snapshot.stations.indices.contains(index) else { return "" }
        let progress = stationProgress(index)
        let skipped = progress.skipped > 0 ? " · \(progress.skipped) skipped" : ""
        return "\(snapshot.stations[index].outline) · \(progress.done)/\(progress.total)\(skipped)"
    }
}
