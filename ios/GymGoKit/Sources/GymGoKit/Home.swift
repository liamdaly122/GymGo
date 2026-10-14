import Foundation

// What the watch shows when no workout runs. The phone decides what is next
// (the same rules as its Today screen) and sends it in `home`; the watch only
// words it, and adds the one thing it knows for itself: what day it is now.

/// The Today page, worded.
public struct TodayCard: Equatable, Sendable {
    public enum Kind: Equatable, Sendable {
        /// Nothing has come from the phone yet.
        case noPhone
        /// A session to start.
        case ready
        /// Started here already; the next one comes from the phone.
        case started
        /// Finished here; it saves when the phone next opens GymGo.
        case waitingForPhone
        /// Discarded here; the phone catches up when it next opens GymGo.
        case discarded
        /// A workout is open on the phone.
        case runningOnPhone
        case blockDone
        case noPlan
    }

    public var kind: Kind
    /// "Today · Week 3 of 5", "Next · Fri", "Done today".
    public var heading: String
    /// The session's name.
    public var title: String?
    /// "6 exercises · about 55 min".
    public var detail: String?
    /// "Moved from Mon", in blue.
    public var movedFrom: String?
    /// Sessions finished today, newest first.
    public var doneToday: [String] = []
    /// "Start", or "Start early" for a session not due today.
    public var startLabel: String?
    /// A line of explanation for the states with nothing to start.
    public var message: String?

    public var canStart: Bool { kind == .ready }
}

/// "YYYY-MM-DD" for a moment, on the calendar of this time zone.
public func localDay(_ date: Date, timeZone: TimeZone = .current) -> String {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = timeZone
    let parts = calendar.dateComponents([.year, .month, .day], from: date)
    return String(format: "%04d-%02d-%02d", parts.year ?? 0, parts.month ?? 0, parts.day ?? 0)
}

/// Noon on a "YYYY-MM-DD" day, so a weekday never slips across midnight.
func noon(of day: String, timeZone: TimeZone) -> Date? {
    let parts = day.split(separator: "-").compactMap { Int($0) }
    guard parts.count == 3 else { return nil }
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = timeZone
    return calendar.date(from: DateComponents(year: parts[0], month: parts[1], day: parts[2], hour: 12))
}

private let weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
private let months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

/// "Fri" for a day in the coming week, else "24 Oct".
public func dayLabel(_ day: String, from today: String, timeZone: TimeZone = .current) -> String {
    guard let date = noon(of: day, timeZone: timeZone), let now = noon(of: today, timeZone: timeZone) else { return day }
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = timeZone
    let parts = calendar.dateComponents([.weekday, .day, .month], from: date)
    let ahead = calendar.dateComponents([.day], from: now, to: date).day ?? 0
    if (-6...6).contains(ahead) { return weekdays[(parts.weekday ?? 1) - 1] }
    return "\(parts.day ?? 0) \(months[(parts.month ?? 1) - 1])"
}

extension WatchAppState {
    /// The Today page as of `now` on the watch's own clock. The phone's data
    /// may be from an earlier day: a session it planned for a day already
    /// gone has rolled forward to today, by the phone's own rule, and what it
    /// called done "today" was done another day.
    public func todayCard(now: Date, timeZone: TimeZone = .current) -> TodayCard {
        guard let home else {
            return TodayCard(kind: .noPhone, heading: "GymGo", message: "Open GymGo on your iPhone to load your sessions.")
        }
        let today = localDay(now, timeZone: timeZone)
        let doneToday = home.today == today ? home.doneToday.map(\.name) : []

        if home.state == .running || liveWorkoutId != nil {
            if let live = liveWorkoutId, discardedHere.contains(live) {
                return TodayCard(
                    kind: .discarded, heading: "Discarded", doneToday: doneToday,
                    message: "Your iPhone catches up next time you open GymGo."
                )
            }
            if let live = liveWorkoutId, endedWorkouts.contains(live) {
                return TodayCard(
                    kind: .waitingForPhone, heading: "Done today", doneToday: doneToday,
                    message: "It saves on your iPhone next time you open GymGo."
                )
            }
            return TodayCard(kind: .runningOnPhone, heading: "On your iPhone", doneToday: doneToday, message: "A workout is open on your iPhone.")
        }

        if let ready = home.ready {
            if usedReadyKeys.contains(ready.key) {
                return TodayCard(
                    kind: .started, heading: "Done today", title: ready.name, doneToday: doneToday,
                    message: "Next session loads from your iPhone."
                )
            }
            if endedWorkouts.contains(ready.snapshot.workoutId), ready.mintedIds == nil {
                // Discarded here, and its layout is not one the watch can lay
                // out again under new IDs: the phone offers it again once it
                // has caught up. Otherwise it starts again, under new IDs.
                return TodayCard(
                    kind: .discarded, heading: "Discarded", title: ready.name, doneToday: doneToday,
                    message: "It comes back when your iPhone next opens GymGo."
                )
            }
            let due = max(ready.date, today)
            let isToday = due == today
            let heading = isToday
                ? (["Today"] + [ready.week?.label].compactMap { $0 }).joined(separator: " · ")
                : "Next · \(dayLabel(ready.date, from: today, timeZone: timeZone))"
            let count = ready.exercises.count
            return TodayCard(
                kind: .ready,
                heading: heading,
                title: ready.name,
                detail: "\(count) exercise\(count == 1 ? "" : "s") · about \(ready.minutes) min",
                movedFrom: ready.movedFrom.map { "Moved from \(dayLabel($0, from: today, timeZone: timeZone))" },
                doneToday: doneToday,
                startLabel: isToday ? "Start" : "Start early"
            )
        }

        switch home.state {
        case .blockDone:
            return TodayCard(kind: .blockDone, heading: "Block done", doneToday: doneToday, message: "Start the next one on your iPhone.")
        default:
            return TodayCard(kind: .noPlan, heading: "No session planned", doneToday: doneToday, message: "Plan one on your iPhone, or start a workout there.")
        }
    }
}
