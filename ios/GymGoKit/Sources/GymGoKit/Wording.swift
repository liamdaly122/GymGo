import Foundation

// What the watch's workout screens say, worded here where it is tested.
// GymGoWatchUI lays it out; nothing here knows about views.

extension SetInHand {
    /// Why the numbers are what they are, in a word: the plan's own verb
    /// ("Go up") while they are still the list's suggestion, "Lighter" after
    /// a step-down, and nothing after a plain carry, when the numbers are
    /// simply what was just done.
    public var verb: String? {
        if source == "stepped", stepped != nil { return "Lighter" }
        guard source == "suggestion", set.isTopWorkingSet, let plan = lift.plan, !plan.verb.isEmpty else { return nil }
        return plan.verb
    }

    /// The line under the lift's name on the set screen: "Set 1 of 4 · Go up"
    /// while a verb shows, else "Set 2 of 4 · 2/6". The station's place is
    /// dropped for the verb, so the line fits a 41 mm screen.
    public func headerLine(stations: Int) -> String {
        if let verb { return "\(set.label) · \(verb)" }
        return "\(set.label) · \(set.station + 1)/\(max(1, stations))"
    }

    /// Why a stepped set is lighter: "5 was under 8, so 90kg for 8."
    public var stepDownReason: String? {
        guard let stepped else { return nil }
        let weight = numbersOnScreen(nil).weight
        return "\(stepped.from.reps) was under \(stepped.repLow), so \(formatWeight(weight))kg for \(stepped.repLow)."
    }

    /// Whether the rest leads here from another station: its Up next is
    /// this station's name and outline (`upNextFor`). A solo station's name
    /// is its lift's, so the name alone cannot say.
    private func reachedFromAnotherStation(_ rest: RestState) -> Bool {
        rest.upNext.name == station.name && rest.upNext.detail == station.outline
    }

    /// The rest's Up next detail on the wrist. Up next was worded when the
    /// rest began, or when the set in hand last moved; a newer list from the
    /// phone may have moved the numbers since. When the rest leads to this
    /// set at the station it followed, the numbers the set screen will start
    /// at now ("Set 2 of 4 · 102.5 × 5"); from another station, its outline
    /// as it was, which the state report, the companion and the Live
    /// Activity say too.
    public func upNextDetail(after rest: RestState) -> String {
        guard !reachedFromAnotherStation(rest), rest.upNext.name == lift.name, let reps, reps > 0 else {
            return rest.upNext.detail
        }
        return screenDetail
    }

    /// The rest's third line, under Up next, when this is the set after it:
    /// the lift's setup note when the rest leads to a new station, else how
    /// the lift went last time ("Last 97.5 × 8") when nothing of it is done
    /// today. The setup note wins when both could show.
    public func restNote(after rest: RestState) -> String? {
        if reachedFromAnotherStation(rest), let note = lift.setupNote, !note.isEmpty {
            return note
        }
        guard firstOfLiftToday, let last = lift.lastTime else { return nil }
        return "Last \(formatLogged(last.top.weight, last.top.reps))"
    }
}

extension LastTime {
    /// "Last time · 3 Oct", or the weekday within the last week, on the
    /// watch's own calendar: the phone sends the day, never relative words.
    public func heading(today: String, timeZone: TimeZone = .current) -> String {
        "Last time · \(dayLabel(day, from: today, timeZone: timeZone))"
    }

    /// The working sets: "97.5 × 8, 8, 7" when they share a weight, else
    /// each as done, "100 × 5, 95 × 6".
    public var setsLine: String {
        guard let first = sets.first else { return formatLogged(top.weight, top.reps) }
        guard sets.allSatisfy({ $0.weight == first.weight }) else {
            return sets.map { formatLogged($0.weight, $0.reps) }.joined(separator: ", ")
        }
        return "\(first.weight > 0 ? formatWeight(first.weight) : "BW") × " + sets.map { String($0.reps) }.joined(separator: ", ")
    }
}

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
