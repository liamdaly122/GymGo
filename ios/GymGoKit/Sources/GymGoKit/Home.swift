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

/// A Health workout recording with no session behind it, as the Today page
/// words it when it offers to end it. Ending it throws it away: the button
/// says so itself, not only to VoiceOver, since End used to save.
public enum StrayRecording {
    public static let caption = "Recording a workout in Health"
    /// The button's visible text.
    public static let endLabel = "End, not saved"
    /// The button's accessible name.
    public static let endSpoken = "End the Health workout, not saved"
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
    /// The Today page as of `now` on the watch's own clock: its inputs,
    /// worded by `TodayCard(_:now:)`, the one rule the complications read
    /// too.
    public func todayCard(now: Date, timeZone: TimeZone = .current) -> TodayCard {
        TodayCard(todayInputs(timeZone: timeZone), now: now, timeZone: timeZone)
    }
}

// MARK: - The Today page's inputs, for the watch face too

/// What the Today page is worded from, and nothing more: no session's sets,
/// no layout. The complications read these from `glance.json` and word each
/// moment themselves with `TodayCard(_:now:)`, the same rule as the app, so
/// "Next · Fri" becomes "Today" at midnight with no app running.
public struct TodayInputs: Codable, Sendable, Equatable {
    public struct Ready: Codable, Sendable, Equatable {
        public var name: String
        public var date: String
        public var weekLabel: String?
        public var minutes: Int
        public var exercises: Int
        public var movedFrom: String?
        /// Started on the wrist already: its ready key is used.
        public var used: Bool
        /// Discarded here, and not a layout the watch can lay out again.
        public var discarded: Bool

        public init(
            name: String, date: String, weekLabel: String?, minutes: Int, exercises: Int,
            movedFrom: String?, used: Bool, discarded: Bool
        ) {
            self.name = name
            self.date = date
            self.weekLabel = weekLabel
            self.minutes = minutes
            self.exercises = exercises
            self.movedFrom = movedFrom
            self.used = used
            self.discarded = discarded
        }
    }

    /// The phone's day when it built `home`.
    public var phoneToday: String
    public var state: WatchHome.State
    /// Sessions the phone finished on `phoneToday`, newest first.
    public var doneToday: [String]
    public var ready: Ready?
    public var week: [WatchWeekDay]
    /// A workout is open on the phone (`home.state == .running`, or `live`).
    public var liveOnPhone: Bool
    /// That workout was discarded on the wrist.
    public var liveDiscardedHere: Bool
    /// That workout's session ended on the wrist, and the phone has not heard.
    public var liveEnded: Bool
    /// The lifter's day a session done on the wrist began, "2026-10-14", so
    /// a "Done" card the phone has not caught up with reads "Done · Wed" on
    /// later days rather than "Done today". Nil when not known (a state
    /// saved before it was kept).
    public var doneHereDay: String?

    public init(
        phoneToday: String, state: WatchHome.State, doneToday: [String], ready: Ready?, week: [WatchWeekDay],
        liveOnPhone: Bool, liveDiscardedHere: Bool, liveEnded: Bool, doneHereDay: String? = nil
    ) {
        self.phoneToday = phoneToday
        self.state = state
        self.doneToday = doneToday
        self.ready = ready
        self.week = week
        self.liveOnPhone = liveOnPhone
        self.liveDiscardedHere = liveDiscardedHere
        self.liveEnded = liveEnded
        self.doneHereDay = doneHereDay
    }
}

extension WatchAppState {
    /// The Today page's inputs, with this time zone's calendar for the day a
    /// session was done here. Nil until the phone has sent anything.
    public func todayInputs(timeZone: TimeZone = .current) -> TodayInputs? {
        guard let home else { return nil }
        let live = liveWorkoutId
        // The day the session that ended last began: what a "Done" card
        // means, once the phone has not caught up by the next day. Nil while
        // a session runs, when no Today card shows.
        let doneHereDay = session == nil
            ? lastEndedStartedAt.map { WatchSession.date($0) }.flatMap { $0 > .distantPast ? localDay($0, timeZone: timeZone) : nil }
            : nil
        return TodayInputs(
            phoneToday: home.today,
            state: home.state,
            doneToday: home.doneToday.map(\.name),
            ready: home.ready.map { ready in
                TodayInputs.Ready(
                    name: ready.name, date: ready.date, weekLabel: ready.week?.label, minutes: ready.minutes,
                    exercises: ready.exercises.count, movedFrom: ready.movedFrom,
                    used: usedReadyKeys.contains(ready.key),
                    discarded: endedWorkouts.contains(ready.snapshot.workoutId) && ready.mintedIds == nil
                )
            },
            week: home.week,
            liveOnPhone: home.state == .running || live != nil,
            liveDiscardedHere: live.map(discardedHere.contains) ?? false,
            liveEnded: live.map(endedWorkouts.contains) ?? false,
            doneHereDay: doneHereDay
        )
    }

    /// The Today page's inputs, on the watch's own time zone.
    public var todayInputs: TodayInputs? { todayInputs(timeZone: .current) }
}

extension TodayCard {
    /// The Today page as of `now` on the watch's own clock, worded from its
    /// inputs: the one rule, read by the Today page and the complications.
    /// The phone's data may be from an earlier day: a session it planned for
    /// a day already gone has rolled forward to today, by the phone's own
    /// rule, and what it called done "today" was done another day.
    public init(_ inputs: TodayInputs?, now: Date, timeZone: TimeZone = .current) {
        guard let home = inputs else {
            self.init(kind: .noPhone, heading: "GymGo", message: "Open GymGo on your iPhone to load your sessions.")
            return
        }
        let today = localDay(now, timeZone: timeZone)
        let doneToday = home.phoneToday == today ? home.doneToday : []
        // Done on the wrist, the phone not caught up: "Done today" only on
        // the day it was done, then the day it was done ("Done · Wed").
        let doneHere = home.doneHereDay.flatMap { $0 < today ? "Done · \(dayLabel($0, from: today, timeZone: timeZone))" : nil }
            ?? "Done today"

        if home.liveOnPhone {
            if home.liveDiscardedHere {
                self.init(
                    kind: .discarded, heading: "Discarded", doneToday: doneToday,
                    message: "Your iPhone catches up next time you open GymGo."
                )
            } else if home.liveEnded {
                self.init(
                    kind: .waitingForPhone, heading: doneHere, doneToday: doneToday,
                    message: "It saves on your iPhone next time you open GymGo."
                )
            } else {
                self.init(kind: .runningOnPhone, heading: "On your iPhone", doneToday: doneToday, message: "A workout is open on your iPhone.")
            }
            return
        }

        if let ready = home.ready {
            if ready.used {
                self.init(
                    kind: .started, heading: doneHere, title: ready.name, doneToday: doneToday,
                    message: "Next session loads from your iPhone."
                )
                return
            }
            if ready.discarded {
                // Discarded here, and its layout is not one the watch can lay
                // out again under new IDs: the phone offers it again once it
                // has caught up. Otherwise it starts again, under new IDs.
                self.init(
                    kind: .discarded, heading: "Discarded", title: ready.name, doneToday: doneToday,
                    message: "It comes back when your iPhone next opens GymGo."
                )
                return
            }
            let due = max(ready.date, today)
            let isToday = due == today
            let heading = isToday
                ? (["Today"] + [ready.weekLabel].compactMap { $0 }).joined(separator: " · ")
                : "Next · \(dayLabel(ready.date, from: today, timeZone: timeZone))"
            let count = ready.exercises
            self.init(
                kind: .ready,
                heading: heading,
                title: ready.name,
                detail: "\(count) exercise\(count == 1 ? "" : "s") · about \(ready.minutes) min",
                movedFrom: ready.movedFrom.map { "Moved from \(dayLabel($0, from: today, timeZone: timeZone))" },
                doneToday: doneToday,
                startLabel: isToday ? "Start" : "Start early"
            )
            return
        }

        switch home.state {
        case .blockDone:
            self.init(kind: .blockDone, heading: "Block done", doneToday: doneToday, message: "Start the next one on your iPhone.")
        default:
            self.init(kind: .noPlan, heading: "No session planned", doneToday: doneToday, message: "Plan one on your iPhone, or start a workout there.")
        }
    }
}
