import Foundation
import GymGoKit
import SwiftUI
import WidgetKit

// Xcode canvas previews: each family, before a session and mid-rest.

private enum PreviewGlance {
    static let week: [WatchWeekDay] = {
        let today = Date()
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = .current
        let monday = calendar.date(byAdding: .day, value: -((calendar.component(.weekday, from: today) + 5) % 7), to: today)!
        let plan: [(WatchWeekDay.State, String?)] = [
            (.done, "Push A"), (.rest, nil), (.planned, "Pull A"), (.rest, nil), (.planned, "Legs A"), (.rest, nil), (.rest, nil),
        ]
        // Built as the phone sends it: the type has no public initialiser.
        let days: [[String: Any]] = plan.enumerated().map { index, entry in
            let date = calendar.date(byAdding: .day, value: index, to: monday)!
            let day = localDay(date)
            let weekday = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][index]
            let state: WatchWeekDay.State = day == localDay(today) && entry.0 == .planned ? .today : entry.0
            return ["date": day, "weekday": weekday, "state": state.rawValue, "name": entry.1 as Any]
        }
        guard let data = try? JSONSerialization.data(withJSONObject: days) else { return [] }
        return (try? JSONDecoder().decode([WatchWeekDay].self, from: data)) ?? []
    }()

    static var today: WatchGlance {
        var glance = Sample.ready()
        glance.today?.week = week
        return glance
    }

    static var resting: WatchGlance {
        var glance = today
        let now = Date()
        glance.session = GlanceSession(
            title: "Push A", startedAt: now.addingTimeInterval(-20 * 60), setsDone: 7, setsTotal: 18,
            station: "Bench Press", setLabel: "Set 3 of 4", loggingOnPhone: false,
            rest: GlanceRest(startedAt: now, endsAt: now.addingTimeInterval(150), upNext: "Bench Press", upNextDetail: "Set 3 of 4 · 100 × 5")
        )
        return glance
    }
}

#Preview("Today", as: .accessoryRectangular) {
    NextSessionWidget()
} timeline: {
    GlanceEntry(PreviewGlance.today.moment(at: .now))
    GlanceEntry(PreviewGlance.resting.moment(at: .now))
}

#Preview("Ring", as: .accessoryCircular) {
    NextSessionWidget()
} timeline: {
    GlanceEntry(PreviewGlance.today.moment(at: .now))
    GlanceEntry(PreviewGlance.resting.moment(at: .now))
}

#Preview("Corner", as: .accessoryCorner) {
    NextSessionWidget()
} timeline: {
    GlanceEntry(PreviewGlance.today.moment(at: .now))
    GlanceEntry(PreviewGlance.resting.moment(at: .now))
}

#Preview("Inline", as: .accessoryInline) {
    NextSessionWidget()
} timeline: {
    GlanceEntry(PreviewGlance.today.moment(at: .now))
    GlanceEntry(PreviewGlance.resting.moment(at: .now))
}
