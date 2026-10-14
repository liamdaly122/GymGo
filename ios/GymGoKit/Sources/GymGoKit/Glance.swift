import Foundation

// What the watch face shows: the Today page and the session on the wrist,
// small enough for the complications extension to read on every timeline.
//
// The watch app writes it to the App Group container whenever it changes
// (`WatchGlance.init(_:now:previous:)`, from GymGoWatchUI's GlancePublisher);
// the extension reads it and words each moment itself (`moments(from:)`), so
// Today turns over at midnight with no app running and no reload. It holds
// the inputs of the Today card, not a worded card, for exactly that reason:
// "Next · Fri" becomes "Today" on Friday, and "Done today" empties at
// midnight, on the watch's own clock. Foundation only, so `swift test`
// covers it on the Mac; the extension links GymGoKit and nothing else.

/// The App Group the watch app and its complications share. Each device has
/// its own container under this name: the phone's and the watch's never sync.
public let gymGoAppGroup = "group.com.liamdaly.gymgo"

/// The complication's widget kind. Never rename it: a face holding the old
/// kind loses the complication.
public let glanceWidgetKind = "com.liamdaly.gymgo.next"

// MARK: - The session on the wrist

public struct GlanceRest: Codable, Sendable, Equatable {
    public var startedAt: Date
    public var endsAt: Date
    /// The exercise the rest leads to, and its line: "Set 3 of 4 · 100 × 5".
    public var upNext: String
    public var upNextDetail: String

    public init(startedAt: Date, endsAt: Date, upNext: String, upNextDetail: String) {
        self.startedAt = startedAt
        self.endsAt = endsAt
        self.upNext = upNext
        self.upNextDetail = upNextDetail
    }
}

public struct GlanceSession: Codable, Sendable, Equatable {
    public var title: String
    public var startedAt: Date
    public var setsDone: Int
    public var setsTotal: Int
    /// The station in hand, and its set: "Bench Press", "Set 3 of 4". Nil
    /// while the phone logs, or with nothing left to log.
    public var station: String?
    public var setLabel: String?
    public var loggingOnPhone: Bool
    public var rest: GlanceRest?

    public init(
        title: String, startedAt: Date, setsDone: Int, setsTotal: Int, station: String?, setLabel: String?,
        loggingOnPhone: Bool, rest: GlanceRest?
    ) {
        self.title = title
        self.startedAt = startedAt
        self.setsDone = setsDone
        self.setsTotal = setsTotal
        self.station = station
        self.setLabel = setLabel
        self.loggingOnPhone = loggingOnPhone
        self.rest = rest
    }
}

// MARK: - The file

/// Everything the complications show, as the watch app last wrote it.
///
/// No timestamp of its own: the app compares the new glance with the last
/// one and reloads the complications only when what they show has changed,
/// which a clock in here would defeat.
public struct WatchGlance: Codable, Sendable, Equatable {
    public static let version = 1
    public static let fileName = "glance.json"

    public var v: Int
    public var today: TodayInputs?
    public var session: GlanceSession?
    /// The day of a session done on the wrist that the phone has not heard
    /// of yet: that day's mark reads done, and later days no longer say
    /// "Done today".
    public var doneHereDay: String?

    public init(v: Int = WatchGlance.version, today: TodayInputs?, session: GlanceSession?, doneHereDay: String?) {
        self.v = v
        self.today = today
        self.session = session
        self.doneHereDay = doneHereDay
    }

    /// Nothing from the phone yet, nothing on the wrist: what the face shows
    /// before the app has ever written, or with no App Group to read.
    public static let empty = WatchGlance(today: nil, session: nil, doneHereDay: nil)

    /// The glance for the state as of `now`. `previous` keeps the day a
    /// session was done on the wrist, which the state does not remember.
    public init(_ state: WatchAppState, now: Date, previous: WatchGlance?, timeZone: TimeZone = .current) {
        let inputs = state.todayInputs
        let card = TodayCard(inputs, now: now, timeZone: timeZone)
        var session: GlanceSession?
        if let running = state.session {
            let progress = running.progress
            let inHand = state.setInHand
            session = GlanceSession(
                title: running.snapshot.title,
                startedAt: WatchSession.date(running.snapshot.startedAt),
                setsDone: progress.done,
                setsTotal: progress.total,
                station: inHand?.station.name,
                setLabel: inHand?.set.label,
                loggingOnPhone: state.owner == .phone,
                rest: state.rest.map {
                    GlanceRest(startedAt: $0.startedAt, endsAt: $0.endsAt, upNext: $0.upNext.name, upNextDetail: $0.upNext.detail)
                }
            )
        }
        let doneHere = session == nil && Self.doneHere(card.kind)
        // The day it was trained: the session the last glance showed began
        // on it, even when it finished after midnight.
        let day = previous?.doneHereDay
            ?? previous?.session.map { localDay($0.startedAt, timeZone: timeZone) }
            ?? localDay(now, timeZone: timeZone)
        self.init(today: inputs, session: session, doneHereDay: doneHere ? day : nil)
    }

    /// Done on the wrist, and the phone has not heard yet.
    static func doneHere(_ kind: TodayCard.Kind) -> Bool {
        kind == .started || kind == .waitingForPhone
    }

    /// The glance in the App Group, at `url`. Nil when there is no App Group
    /// (`containerURL` gives nil without the entitlement), no file yet, or a
    /// file this build cannot read: the face then shows `empty`.
    public static func read(from url: URL?) -> WatchGlance? {
        guard let url, let data = try? Data(contentsOf: url),
              let glance = try? JSONDecoder().decode(WatchGlance.self, from: data),
              glance.v <= version else { return nil }
        return glance
    }

    /// Where the glance lives: nil without the App Group entitlement. Not for
    /// the Mac tests, where asking for a group container can prompt.
    public static func defaultURL(appGroup: String = gymGoAppGroup) -> URL? {
        FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroup)?
            .appendingPathComponent(fileName)
    }

    public func encoded() throws -> Data {
        let encoder = JSONEncoder()
        encoder.outputFormatting = .sortedKeys
        return try encoder.encode(self)
    }

    /// Whether the face needs a new timeline once this glance replaces
    /// `previous`. Every reload spends the day's budget, mostly wrist-down
    /// mid-session, so not when nothing changed, and not when the only change
    /// is a rest that has run its course: the timeline already holds an
    /// entry at its end, which shows exactly this.
    public func needsReload(over previous: WatchGlance?, now: Date) -> Bool {
        guard self != previous else { return false }
        if var before = previous, let rest = before.session?.rest, session?.rest == nil,
           rest.endsAt <= now.addingTimeInterval(Self.restEndSlack) {
            before.session?.rest = nil
            if before == self { return false }
        }
        return true
    }

    /// A rest's end, by the timer or its notification, can land a moment
    /// either side of `endsAt`.
    static let restEndSlack: TimeInterval = 2
}

// MARK: - Moments: the timeline, worked out

/// One day of the week strip, as the face draws it.
public struct WeekMark: Sendable, Equatable {
    /// "M", "T", ...
    public var letter: String
    public var state: WatchWeekDay.State
    public var isToday: Bool
    /// "Fri, Push A, done", for VoiceOver.
    public var spoken: String
}

/// What the face shows from `date` until the next moment.
public struct GlanceMoment: Sendable, Equatable {
    public enum Phase: Sendable, Equatable {
        case today
        case session(GlanceSession)
        case resting(GlanceSession, GlanceRest)
    }

    public var date: Date
    public var day: String
    public var card: TodayCard
    public var phase: Phase
    /// This week's days. Empty once the phone's week is over, rather than
    /// marks for a week already gone.
    public var week: [WeekMark]
    /// Training days this week, and how many are done: the circular ring.
    public var planned: Int
    public var done: Int
    /// A session done on the wrist today, the phone not caught up: a tick.
    public var doneHereToday: Bool
    /// The day the session on offer is due, when that is not today: "Fri",
    /// "24 Oct". Nil when it is due today, or nothing is on offer.
    public var dueLater: String?

    /// One line for the inline and corner families: "Push A · Today",
    /// "Push A · Fri", else the card's heading.
    public var shortLine: String {
        switch card.kind {
        case .ready: "\(card.title ?? "GymGo") · \(dueLater ?? "Today")"
        case .noPhone: "Open GymGo on your iPhone"
        default: card.heading
        }
    }
}

extension WatchGlance {
    /// The moments from `now`: now, the end of a rest under way, and each
    /// local midnight for `days` days, so a timeline that reloads `.atEnd`
    /// asks again only a week on. A session on the wrist shows in every one
    /// of them: the app writes again, and reloads, when it ends.
    public func moments(from now: Date, days: Int = 7, timeZone: TimeZone = .current) -> [GlanceMoment] {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = timeZone
        var dates = [now]
        if let rest = session?.rest, rest.endsAt > now { dates.append(rest.endsAt) }
        let midnight = calendar.startOfDay(for: now)
        for day in 1...max(1, days) {
            if let next = calendar.date(byAdding: .day, value: day, to: midnight) { dates.append(next) }
        }
        return dates.sorted().map { moment(at: $0, timeZone: timeZone) }
    }

    public func moment(at date: Date, timeZone: TimeZone = .current) -> GlanceMoment {
        let day = localDay(date, timeZone: timeZone)
        var card = TodayCard(today, now: date, timeZone: timeZone)
        // Done on the wrist, the phone not caught up: "Done today" only on
        // the day it was done. The Today page cannot tell (it does not know
        // the day); the face can.
        var doneHereToday = false
        if Self.doneHere(card.kind) {
            if let doneHereDay, doneHereDay != day {
                card.heading = "Done · \(dayLabel(doneHereDay, from: day, timeZone: timeZone))"
            } else {
                doneHereToday = true
            }
        }

        let phase: GlanceMoment.Phase
        if let session {
            if let rest = session.rest, rest.endsAt > date {
                phase = .resting(session, rest)
            } else {
                phase = .session(session)
            }
        } else {
            phase = .today
        }

        let days = today?.week ?? []
        let inWeek = days.contains { $0.date == day }
        let marks: [WeekMark] = inWeek ? days.map { weekDay in
            var state = weekDay.state
            if weekDay.date == doneHereDay, state != .rest { state = .done }
            let isToday = weekDay.date == day
            var spoken = [weekDay.weekday + (isToday ? ", today" : ""), weekDay.name ?? "rest day"]
            if state == .done { spoken.append("done") } else if state != .rest { spoken.append("planned") }
            return WeekMark(
                letter: String(weekDay.weekday.prefix(1)), state: state, isToday: isToday,
                spoken: spoken.joined(separator: ", ")
            )
        } : []
        return GlanceMoment(
            date: date, day: day, card: card, phase: phase, week: marks,
            planned: marks.filter { $0.state != .rest }.count,
            done: marks.filter { $0.state == .done }.count,
            doneHereToday: doneHereToday,
            dueLater: today?.ready.flatMap { ready in
                card.kind == .ready && ready.date > day ? dayLabel(ready.date, from: day, timeZone: timeZone) : nil
            }
        )
    }

    /// The days still to train, for the Smart Stack's relevance: the week's
    /// training days from today, and the session on offer, but not one done
    /// on the wrist that the phone has not heard of.
    public func trainingDays(from now: Date, timeZone: TimeZone = .current) -> [String] {
        let today = localDay(now, timeZone: timeZone)
        var days = (self.today?.week ?? [])
            .filter { ($0.state == .planned || $0.state == .today) && $0.date >= today }
            .map(\.date)
        if let ready = self.today?.ready, !ready.used, !ready.discarded { days.append(max(ready.date, today)) }
        return Set(days).subtracting([doneHereDay].compactMap { $0 }).sorted()
    }

    /// The hours of a training day the Smart Stack should offer GymGo: when
    /// a lifter is up, early bird to night owl. Not the small hours.
    public static let wakingHours = (from: 5, to: 22)

    /// Each training day's waking hours, in the watch's time zone: the
    /// windows the extension's `relevance()` names, as `.scheduled` (a day
    /// with a session to start).
    public func relevantWindows(from now: Date, timeZone: TimeZone = .current) -> [DateInterval] {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = timeZone
        return trainingDays(from: now, timeZone: timeZone).compactMap { day in
            let parts = day.split(separator: "-").compactMap { Int($0) }
            guard parts.count == 3,
                  let start = calendar.date(from: DateComponents(year: parts[0], month: parts[1], day: parts[2], hour: Self.wakingHours.from)),
                  let end = calendar.date(from: DateComponents(year: parts[0], month: parts[1], day: parts[2], hour: Self.wakingHours.to)),
                  end > now else { return nil }
            return DateInterval(start: start, end: end)
        }
    }
}
